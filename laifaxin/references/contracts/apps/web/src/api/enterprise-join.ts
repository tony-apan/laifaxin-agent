import { postEnvelope, postEnvelopeFull } from '@/api/auth';

/**
 * 通过邀请链接加入企业。**这是唯一一条从站外进来的企业流程** ——
 * 链接由 `enterprise-teams.ts` 的 {@link buildInviteLink} 生成,发给还不是成员的人。
 *
 * 两个端点、两种「失败」表达方式,别混:
 *
 * | | 成功时 | 失败时 |
 * |---|---|---|
 * | `invite-link-status` | `success:true` + `data.status` | **还是 `success:true`**,失败藏在 `data.status==='error'` |
 * | `invite-link-join`   | `success:true` + `data.status` | `success:false` + 中文 message |
 *
 * ⚠️ 所以查状态**不能靠 `postEnvelope` 抛异常来发现问题** —— 企业不存在、
 * 邀请码不对、链接过期,三种都回 `success:true`。必须读 `data.status`。
 * 老项目 `join/index.tsx` 正是这么做的,照抄这一点。
 *
 * 身份取的是登录用户自己,不是当前工作区:后端 status 用 `ctx.userInfo.uid`、
 * join 用 `ctx.orgInfo.userid`,而中间件里这两个是同一个值
 * (`middleware/user.ts:80`)。所以**人在哪个工作区都不影响加入结果**,
 * 前端不用先切工作区再加入。
 */

/**
 * 邀请状态。
 *
 * - `none`    没加入过,可以点「立即加入」
 * - `waiting` 已申请,等管理员审核(企业开了 `inviteAudit`)
 * - `ok`      已经是成员
 * - `refuse`  申请被拒绝过
 * - `error`   链接本身有问题,`message` 里是原因
 *
 * ⚠️ `refuse` 是**终态**:后端 `inviteLinkJoin` 见到 status 9 的记录直接回
 * 「您的申请被拒绝」,再点多少次都一样。界面上不能给「再试一次」。
 */
export const INVITE_STATUSES = ['none', 'waiting', 'ok', 'refuse', 'error'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export interface InviteInfo {
  status: InviteStatus;
  /** 企业名称。**企业不存在时后端不返回它**,所以可能是空串 */
  orgName: string;
  /** 只有 status==='error' 时有值 */
  message: string;
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

/** 认不出的状态一律当 error,不当成「可以加入」—— 猜错的方向要选安全的那个 */
const toStatus = (v: unknown): InviteStatus =>
  (INVITE_STATUSES as readonly string[]).includes(str(v)) ? (str(v) as InviteStatus) : 'error';

export function normalizeInviteInfo(raw: unknown): InviteInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    status: toStatus(r.status),
    orgName: str(r.orgName),
    message: str(r.message),
  };
}

/**
 * 查邀请状态。**参数名是 `corpId`**(后端 DTO 就叫这个),
 * 而老项目生成链接时拼的是 `corpld`(小写 L)—— 那是 URL 参数的事,
 * 由 `parseInviteSearch` 归一,到这一层已经是正确拼写了。
 */
export const getInviteInfo = async (corpId: string, inviteCode: string): Promise<InviteInfo> =>
  normalizeInviteInfo(
    await postEnvelope<unknown>('/enterprise/invite-link-status', { corpId, inviteCode }),
  );

/**
 * 提交加入。
 *
 * 返回的是**整个信封**而不是 data:后端把「您已经是该企业成员」「您已申请加入,
 * 等待审核」「您的申请被拒绝」都归成 `success:false` + message —— 这些不是错误,
 * 是需要原样念给用户听的状态。用 `postEnvelope` 会把它们变成异常,
 * 界面就只能显示一个红色 toast,读不到「等审核」和「被拒绝」的区别。
 *
 * 成功时 `data.status` 是 `'ok'`(免审核,已是成员)或 `'waiting'`(等审核),
 * 取决于企业的 `inviteAudit` 设置。
 */
export const joinByInvite = (corpId: string, inviteCode: string) =>
  postEnvelopeFull<{ status?: string } | undefined>('/enterprise/invite-link-join', {
    corpId,
    inviteCode,
  });
