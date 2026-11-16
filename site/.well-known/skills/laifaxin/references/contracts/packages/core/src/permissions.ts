/**
 * 企业权限。
 *
 * 后端的判定在 `laifaxin-server/src/middleware/auth.ts` → `service/auth.ts` 的
 * `check(uid, userid, url)`。**这一层是它的镜像,规则原样照搬,不自己发明。**
 * 前端多判或少判都会与真实行为对不上:多判是本可以用的功能点不开,
 * 少判是点开之后吃一个「权限不足 xxx」。
 *
 * 后端那段的完整逻辑(按顺序):
 *
 * ```js
 * if (!uid) return { checked: false };            // 没有工作区 → 全禁
 * if (uid === userid) return { checked: true };   // 个人工作区 → 全放行
 * url = url.split('?')[0];
 * // 额度路径先统一大小写、移除尾部斜杠，旧 quota-status 映射 quota/show。
 * if (url.indexOf('-') > 0) return { checked: true };  // 其余旧连字符路径兼容
 * const paths = url.split('/');
 * if (paths.length !== 4) return { checked: true };    // 只校验恰好三段的路径
 * const key = paths.slice(1).join('.');           // /enterprise/teams/show → enterprise.teams.show
 * if (permissions.owner) return { checked: true };
 * return { checked: permissions[key]?.checked };
 * ```
 *
 * 额度接口显式校验权限；其他历史连字符路径仍按服务端兼容规则处理。
 * 例如 `api/enterprise.ts` 的 getOrgProfile 使用 `/enterprise/profile-show`。
 */

/* ---------- 权限键 ---------- */

/**
 * 企业那 19 条。全集共 67 条 10 组,在后端 `src/common/enterprise.ts` 的
 * `Permissions` 常量里;这里只列本模块要用的,其余等各自的页面迁过来再补 ——
 * 一次性抄 67 条进来,里面大半会长期没有调用方。
 */
export const PERM = {
  profileShow: 'enterprise.profile.show',
  profileModify: 'enterprise.profile.modify',
  membersShow: 'enterprise.members.show',
  membersInvite: 'enterprise.members.invite',
  membersAudit: 'enterprise.members.audit',
  membersDisable: 'enterprise.members.disable',
  membersModify: 'enterprise.members.modify',
  membersDelete: 'enterprise.members.delete',
  teamsShow: 'enterprise.teams.show',
  teamsManage: 'enterprise.teams.manage',
  teamsChange: 'enterprise.teams.change',
  roleChange: 'enterprise.role.change',
  permissionsShow: 'enterprise.permissions.show',
  permissionsModify: 'enterprise.permissions.modify',
  permissionsManage: 'enterprise.permissions.manage',
  quotaShow: 'enterprise.quota.show',
  quotaManage: 'enterprise.quota.manage',
  quotaModify: 'enterprise.quota.modify',
  operationsShow: 'enterprise.operations.show',
} as const;

export type PermKey = (typeof PERM)[keyof typeof PERM];

/**
 * 从接口路径反推权限键 —— 与后端 `check` 同一套规则。
 *
 * 返回 `null` 表示**这个路径后端根本不校验**(额度以外的历史连字符路径、或段数不是三段),
 * 不是「没权限」。这两件事必须分清:前者要放行,后者要拦。
 *
 * @param path 不带 `/api` 前缀的接口路径,如 `/enterprise/teams/show`
 */
export function permKeyOf(path: string): PermKey | null {
  const clean = path.split('?')[0];
  const quotaPath = clean.toLowerCase().replace(/\/+$/, '');
  if (quotaPath === '/enterprise/quota-status') return PERM.quotaShow;
  if (
    ['/enterprise/quota/show', '/enterprise/quota/manage', '/enterprise/quota/modify'].includes(
      quotaPath,
    )
  ) {
    return quotaPath.slice(1).replaceAll('/', '.') as PermKey;
  }
  // ⚠️ 照抄后端的 `indexOf('-') > 0`:注意是 **> 0** 不是 >= 0,
  // 也就是说路径**以连字符开头**时反而会继续走校验。真实路径不会那样,
  // 但这里如实照搬,免得两边在边角上分叉
  if (clean.indexOf('-') > 0) return null;
  const paths = clean.split('/');
  if (paths.length !== 4) return null;
  return paths.slice(1).join('.') as PermKey;
}

/* ---------- 我的权限 ---------- */

/** 后端 `permissions[key]` 的值形状 */
interface PermEntry {
  checked?: boolean;
}

export interface MyPermissions {
  /** 是不是企业所有者。是的话什么都放行 */
  owner: boolean;
  /** key → 是否勾选 */
  map: Record<string, boolean>;
}

export const EMPTY_PERMISSIONS: MyPermissions = { owner: false, map: {} };

export function normalizePermissions(raw: unknown): MyPermissions {
  if (!raw || typeof raw !== 'object') return EMPTY_PERMISSIONS;
  const r = raw as Record<string, unknown>;
  const map: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'owner') continue;
    // 后端存的是 { checked: boolean };历史数据里也见过直接存布尔的
    if (typeof v === 'boolean') map[k] = v;
    else if (v && typeof v === 'object') map[k] = (v as PermEntry).checked === true;
  }
  return { owner: r.owner === true, map };
}

/* ---------- 判定 ---------- */

/**
 * 能不能做这件事。**规则与后端 `check` 一致**:
 *
 * - 个人工作区(`isOrg === false`)→ 全放行
 * - 所有者 → 全放行
 * - 后端不校验的路径(`permKeyOf` 回 null)→ 放行
 * - 其余看 map
 *
 * 传 `undefined` 的 key 表示「没有对应的后端校验」,放行 —— 与 permKeyOf 的
 * null 语义一致,方便调用方直接把 permKeyOf 的结果传进来。
 */
export function allows(
  perms: MyPermissions | undefined,
  key: PermKey | string | null | undefined,
  isOrg: boolean | undefined,
): boolean {
  // 个人工作区下后端 `uid === userid` 直接放行,没有任何企业权限的概念
  if (isOrg === undefined) return false;
  if (isOrg === false) return true;
  if (!key) return true;
  if (!perms) return false;
  if (perms.owner) return true;
  return perms.map[key] === true;
}
