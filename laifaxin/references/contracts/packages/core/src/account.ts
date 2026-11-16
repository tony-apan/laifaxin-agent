/**
 * 账号信息。契约照搬 laifaxin-web 的 apiAccountCurrent:
 * POST /account/current,信封同认证接口({success,message,data})。
 * 字段可选性也照旧项目 UserInfoType —— 后端按账号类型返回不同子集。
 */
export interface AccountCurrent {
  uid: string;
  userid?: string;
  name?: string;
  nickname?: string;
  avatar?: string;
  email?: string;
  /** 企业账号 */
  isOrg?: boolean;
  orgName?: string;
  /** 会员等级,0 = 普通用户 */
  vip?: number;
  /** 会员到期时间。旧项目用 dayjs 解析,故时间戳与日期串都可能出现;距今 50 年以上视为永久 */
  vipTime?: number | string;
  balance?: number;
  /** 通用点数余额 */
  creditCount?: number;
}

export const ACCOUNT_ENDPOINTS = { current: '/account/current' } as const;

/** 展示用的昵称优先级,与旧项目欢迎页一致 */
export const accountDisplayName = (a: AccountCurrent | undefined, fallback: string) =>
  a?.nickname || a?.name || fallback;

export type VipExpiry = { kind: 'none' } | { kind: 'forever' } | { kind: 'date'; at: number };

/**
 * 会员有效期。旧项目 vipTimeHandle:距今 50 年以上的时间戳表示永久有效,
 * 不是真实日期,直接格式化会显示成 2076 年这类噪声。
 *
 * 入参先过 Date 归一化:旧项目用的是 dayjs(vipDate),说明后端也可能回日期字符串,
 * 直接拿字符串做减法会得到 NaN —— 永久会员会被显示成一个具体日期。
 */
export function vipExpiry(vipTime: number | string | undefined | null): VipExpiry {
  if (!vipTime) return { kind: 'none' };
  const at = new Date(vipTime).getTime();
  if (!Number.isFinite(at)) return { kind: 'none' };
  const FIFTY_YEARS_MS = 50 * 365 * 24 * 3600 * 1000;
  if (at - Date.now() >= FIFTY_YEARS_MS) return { kind: 'forever' };
  return { kind: 'date', at };
}
