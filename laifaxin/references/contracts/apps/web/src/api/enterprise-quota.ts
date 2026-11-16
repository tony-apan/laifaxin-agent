import { postEnvelope, postEnvelopeFull } from '@/api/auth';
import { QUOTA_PERIODS, type QuotaPeriod } from '@/api/enterprise';
import { type PageQuery, pagedPost } from '@/api/enterprise-members';

/**
 * 额度管理:企业的总开关 + 每个成员的额度。
 */

/**
 * 关闭限额时后端塞进 `quotaCount` 的**哨兵值**。
 *
 * `getOrgQuota` 里写死的:
 * ```js
 * if (quotaStatus) return { quotaStatus, quotaPeriod, quotaCount };
 * return { quotaStatus: false, quotaPeriod, quotaCount: 99999999 };
 * ```
 *
 * 它的意思是「不限制」,不是「限制 9999 万点」。老项目直接渲染出来,
 * 界面上就是「限制点数 99999999」—— 用户看着像个上限,其实是没有上限。
 */
export const QUOTA_UNLIMITED = 99_999_999;

export interface OrgQuota {
  /** 有没有开限额 */
  limited: boolean;
  period: QuotaPeriod | string;
  /** 每人每周期的上限。**不限额时是 null**,不是 99999999 */
  limit: number | null;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/**
 * 归一企业额度。两处兜底:
 * - `quotaStatus` 为假时一律给 `limit: null`,把哨兵挡在这一层
 * - 企业文档不存在时后端回 `{}`,这时也当「没开限额」
 */
export function normalizeOrgQuota(raw: unknown): OrgQuota {
  const r = (raw ?? {}) as Record<string, unknown>;
  const limited = r.quotaStatus === true;
  const count = num(r.quotaCount);
  return {
    limited,
    period: typeof r.quotaPeriod === 'string' ? r.quotaPeriod : 'month',
    // 没开限额、或者拿到的正好是哨兵值,都当不限制
    limit: limited && count !== undefined && count !== QUOTA_UNLIMITED ? count : null,
  };
}

export const getOrgQuota = async (): Promise<OrgQuota> =>
  normalizeOrgQuota(await postEnvelope<unknown>('/enterprise/quota-status', {}));

/**
 * 保存企业额度设置。客户端和服务端都只允许三个额度字段；
 * 关闭限制时提交 0，读取时由服务端返回不限制哨兵。
 */
export function saveOrgQuota(q: { limited: boolean; period: string; limit: number }) {
  return postEnvelopeFull<unknown>('/enterprise/quota/manage', {
    quotaStatus: q.limited,
    quotaPeriod: q.period,
    quotaCount: q.limited ? Math.max(0, Math.trunc(q.limit)) : 0,
  });
}

/* ---------- 成员额度 ---------- */

export interface QuotaRow {
  userid: string;
  nickname: string;
  email: string;
  roleName: string;
  teamsName: string;
  status: string;
  /** 这个人是不是有自己的额度 */
  custom: boolean;
  /**
   * 上限。⚠️ **`custom` 为假时这里是企业额度,不是这个人自己的** ——
   * 后端 `quotaCount = quotaCustom ? userQuotaCount : orgQuota.quotaCount`。
   * 而企业没开限额时那个值就是哨兵,所以这里同样归一成 null。
   */
  limit: number | null;
  used: number;
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export function normalizeQuotaRow(r: Record<string, unknown>): QuotaRow {
  const count = num(r.quotaCount);
  return {
    userid: str(r.userid),
    nickname: str(r.nickname),
    email: str(r.email),
    roleName: str(r.role_name),
    teamsName: Array.isArray(r.teamsName)
      ? r.teamsName.filter((name): name is string => typeof name === 'string' && !!name).join(' / ')
      : str(r.teamsName),
    status: str(r.status, 'ok'),
    custom: r.quotaCustom === true,
    limit: count === undefined || count === QUOTA_UNLIMITED ? null : count,
    used: num(r.quotaUsed) ?? 0,
  };
}

export const listQuotas = (q: Partial<PageQuery> & { keyword?: string }) =>
  pagedPost<QuotaRow>(
    '/enterprise/quota/show',
    {
      ...q,
      // filter 会被后端原样并进 mongo 查询,只白名单这一个
      filter: q.keyword?.trim()
        ? { nickname: { $regex: q.keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } }
        : {},
      sort: q.sort ?? { create_time: -1 },
    },
    normalizeQuotaRow,
  );

/**
 * 改某个成员的额度。
 *
 * 后端这个**有解构**(`const { quotaCustom, quotaCount } = data`),
 * 比 orgQuotaSave 安全,但仍然只发白名单。
 *
 * `custom` 为假表示「跟随企业设置」,这时 `quotaCount` 发什么都不影响读取 ——
 * 读的时候后端会拿企业的值顶上。发 0 保持干净。
 */
export function saveMemberQuota(userid: string, custom: boolean, limit: number) {
  return postEnvelopeFull<unknown>('/enterprise/quota/modify', {
    userid,
    quotaCustom: custom,
    quotaCount: custom ? Math.max(0, Math.trunc(limit)) : 0,
  });
}

export type { QuotaPeriod };
/** 周期选项,与 api/enterprise.ts 那份同源 */
export { QUOTA_PERIODS };
