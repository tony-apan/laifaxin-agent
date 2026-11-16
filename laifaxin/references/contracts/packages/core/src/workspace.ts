export interface Workspace {
  /** 企业 id;个人账号时是自己的 userid */
  uid: string;
  /** 企业名;个人账号时是昵称/姓名/userid 依次回落 */
  orgName: string;
  /** false = 个人账号。列表第一条永远是它 */
  isOrg: boolean;
  /** 我在这个企业里的角色名。后端下发中文 */
  roleName: string;
  status: string;
  /** 下面三个**只有个人账号那条有** —— 后端只往个人条目里塞了这些 */
  email?: string;
  phone?: string;
  avatar?: string;
  /** 下面几个只有企业条目才有 */
  quotaPeriod?: string;
  quotaCount?: number;
  quotaUsed?: number;
  vip?: number;
  vipTime?: number;
}

/**
 * 后端拿不到角色时,往 `role_name` 里塞的**中文字面量**,不是空值。
 * 直接渲染的话用户会看到「角色不存在」四个字当成自己的角色。
 */
export const ROLE_MISSING = '角色不存在';

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

export function normalizeWorkspace(r: Record<string, unknown>): Workspace {
  return {
    uid: str(r.uid),
    orgName: str(r.orgName),
    isOrg: r.isOrg === true,
    roleName: str(r.role_name),
    status: str(r.status, 'ok'),
    email: typeof r.email === 'string' ? r.email : undefined,
    phone: typeof r.phone === 'string' ? r.phone : undefined,
    avatar: typeof r.avatar === 'string' ? r.avatar : undefined,
    quotaPeriod: typeof r.quotaPeriod === 'string' ? r.quotaPeriod : undefined,
    quotaCount: num(r.quotaCount),
    quotaUsed: num(r.quotaUsed),
    vip: num(r.vip),
    vipTime: num(r.vipTime),
  };
}

/** 角色名能不能直接给人看 */
export const hasRealRole = (w: Workspace) => !!w.roleName && w.roleName !== ROLE_MISSING;

export const canSwitchWorkspace = (w: Pick<Workspace, 'status'>) => !w.status || w.status === 'ok';

/** 只要企业,不要个人账号那条 */
export const onlyOrgs = (list: Workspace[]) => list.filter((w) => w.isOrg);

/** 个人账号那条。正常永远存在,拿不到时说明后端形状变了 */
export const personalOf = (list: Workspace[]) => list.find((w) => !w.isOrg);
