import { createWorkspaceApi } from '@laifaxin/api-client/workspace';
import type { Workspace } from '@laifaxin/core/workspace';
import { postEnvelope, postEnvelopeFull } from '@/api/auth';

/**
 * 企业(组织)。
 *
 * 后端在 `laifaxin-server/src/controller/enterprise.ts`,40 个路由。这一层只收敛
 * 「我的企业」这一页要用的,其余随后续批次补。
 *
 * 老项目这块最坑的三处,都在这里改掉了:
 *
 * 1. **`organize-exist` 不是查重名,是「退出企业」** —— `exist` 是 `exit` 拼错了。
 *    后端 summary 写着「退出企业(2024-04-11)」,调的是 `memeberQuit`。
 *    老项目函数名叫 `apiEnterpriseOrganizeExist`,光看名字十有八九会当成查重接口
 *    然后拿它去做输入校验 —— 那是把「用户还没提交」变成「已经退出企业」。
 *    这里叫 {@link quitOrganization},并且是唯一的叫法。
 * 2. **没有独立的查重接口**。重名由 `organize-create` 自己判,以 `success:false`
 *    带中文 message 回来。所以「先查再建」这条路根本不存在,别去找那个接口。
 * 3. **`my-organies` 的第一条永远是个人账号**,不是企业。后端在
 *    `getMyOrganizes` 里手动 unshift 进去的,`isOrg:false`、没有额度字段。
 *    老项目多处直接 `list[0]` 当企业用。
 */

/* ---------- 企业规模 ---------- */

/**
 * 预计使用规模。后端 DTO 收 0–10,但界面只给这六档 —— 以界面为准,
 * 传超出范围的值后端会 422。
 */
export const ORG_SCALES = [1, 2, 3, 4, 5, 6] as const;
export type OrgScale = (typeof ORG_SCALES)[number];

/* ---------- 我加入的企业 ---------- */

export type { Workspace } from '@laifaxin/core/workspace';
export {
  canSwitchWorkspace,
  hasRealRole,
  normalizeWorkspace,
  onlyOrgs,
  personalOf,
  ROLE_MISSING,
} from '@laifaxin/core/workspace';
export const { listWorkspaces } = createWorkspaceApi({ postEnvelope });

/**
 * 额度是**夹过**的:后端 `getMyOrganizes` 里
 * `if (quotaCount > quotaUsed + creditCount) quotaCount = quotaUsed + creditCount`。
 * 也就是说「已分配额度」显示的是 min(分配值, 已用+企业余额) ——
 * 企业账上钱不够时,你看到的分配额度会自己缩水。
 * 直接把它当「管理员分给我多少」来解读是错的,所以这里给个明确的名字。
 */
/**
 * 限额周期。取值以后端 `billing/cost.ts:600` 的形参类型为准 ——
 * 那里写死了这四个,**没有 year**。DTO 上只写了 `string`,别照 DTO 猜。
 */
export const QUOTA_PERIODS = ['day', 'week', 'isoWeek', 'month'] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export const isQuotaPeriod = (v: string): v is QuotaPeriod =>
  (QUOTA_PERIODS as readonly string[]).includes(v);

export interface QuotaView {
  /** 周期,后端下发。认不出的值原样带出去,由界面兜底显示 */
  period: string;
  /** 可用上限(已被企业余额夹过) */
  limit: number;
  used: number;
  /** 剩余;夹过之后不会为负 */
  left: number;
}

export function quotaOf(w: Workspace): QuotaView | null {
  if (w.quotaCount === undefined || w.quotaUsed === undefined) return null;
  const limit = w.quotaCount;
  const used = w.quotaUsed;
  return { period: w.quotaPeriod ?? '', limit, used, left: Math.max(0, limit - used) };
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/* ---------- 创建 / 退出 ---------- */

export interface OrgDraft {
  name: string;
  scale: OrgScale;
}

export const emptyOrgDraft = (): OrgDraft => ({ name: '', scale: 1 });

/** 后端 DTO:`name` 1–64 字符必填,`scale` 数字必填 */
export function validateOrgDraft(d: OrgDraft): { name?: string } {
  const name = d.name.trim();
  if (!name) return { name: 'ent.errNameRequired' };
  if (name.length > 64) return { name: 'ent.errNameTooLong' };
  return {};
}

/**
 * 创建企业。
 *
 * **重名和超限都是 `success:false` + 中文 message,不是 HTTP 错误**,
 * 所以这里用 {@link postEnvelopeFull} 拿整个信封,把后端那句人话原样交给界面 ——
 * 比前端自己编一句「创建失败」有用得多(用户需要知道是撞名了还是买的份数用完了)。
 */
export async function createOrganization(d: OrgDraft): Promise<{ ok: boolean; message: string }> {
  const res = await postEnvelopeFull<unknown>('/enterprise/organize-create', {
    name: d.name.trim(),
    scale: d.scale,
  });
  return { ok: res.success === true, message: res.message ?? '' };
}

/**
 * 退出企业。**是软退出** —— 后端 `memeberQuit` 把成员状态改成 `'exiting'`,
 * 记录还在(`service/enterprise.ts:1115`)。
 *
 * 别和 `memberDelete`(:1099)搞混:那个才是 `deleteOne`,而且会连带
 * `resetUserData` 把这个人名下的客户与公司数据一起重置 —— 那个是真的不可逆,
 * 走的是「成员管理」里的删除,不是这里。
 *
 * 后端会挡两种情况,都以 `success:false` + 中文 message 回:
 * 企业不存在、以及**企业所有者不能退出**(得先转让或解散)。同样把原话交给界面。
 */
export async function quitOrganization(orgId: string): Promise<{ ok: boolean; message: string }> {
  const res = await postEnvelopeFull<unknown>('/enterprise/organize-exist', { uid: orgId });
  return { ok: res.success === true, message: res.message ?? '' };
}

/* ---------- 企业资料 ---------- */

export interface OrgProfile {
  uid: string;
  name: string;
  scale?: number;
  /** 邀请码 */
  inviteCode: string;
  /** 成员数 */
  userCount: number;
  owner?: string;
}

/**
 * 企业资料。
 *
 * ⚠️ **打 `/profile-show` 而不是 `/profile/show`**。两个路由的实现一模一样,
 * 区别在后端给带斜杠那个挂了权限校验(`profile-show` 上面明写着 `// 不需要权限`)。
 * 老项目把 `/profile/show` 那版注释掉了却没说为什么,这里补上原因。
 *
 * 另外它虽然叫 show,但**有副作用**:企业还没有邀请码时会顺手生成一个再返回
 * (`inviteLinkRenew`)。所以不能因为「只是查询」就随便重复调用。
 */
export async function getOrgProfile(): Promise<OrgProfile> {
  const r = ((await postEnvelope<Record<string, unknown>>('/enterprise/profile-show', {})) ??
    {}) as Record<string, unknown>;
  return {
    uid: str(r.uid),
    name: str(r.name),
    scale: num(r.scale),
    inviteCode: str(r.inviteCode),
    userCount: num(r.userCount) ?? 0,
    owner: typeof r.owner === 'string' ? r.owner : undefined,
  };
}

/** 我是不是这个企业的所有者 —— 所有者不能退出,界面上要据此改按钮 */
export const isOwner = (p: OrgProfile | undefined, myUserId: string | undefined) =>
  !!p?.owner && !!myUserId && p.owner === myUserId;
