import { postEnvelope, postEnvelopeFull } from '@/api/auth';
import {
  type MemberRow,
  normalizeMemberRow,
  type PageQuery,
  pagedPost,
  VIRTUAL_ROLE_ID,
} from '@/api/enterprise-members';

/**
 * 角色与权限。
 *
 * 角色列表(`listRoles` / `assignableRoles`)在 `enterprise-members.ts` ——
 * 换角色的下拉先要用,落在那里了。这里补权限树与角色的增删改。
 */

/* ---------- 权限树 ---------- */

export interface PermLeaf {
  key: string;
  name: string;
}
export interface PermGroup {
  key: string;
  name: string;
  children: PermLeaf[];
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

/**
 * 权限树。后端返回的是 `common/enterprise.ts` 里那个静态常量 `Permissions`,
 * 10 组 67 条叶子,**不随企业变化** —— 所以可以放心长缓存。
 *
 * 叶子的 key 就是权限键(`enterprise.teams.show` 这种),与
 * `api/permissions.ts` 里 `permKeyOf()` 从 URL 反推出来的是同一套东西。
 */
export const getPermissionTree = async (): Promise<PermGroup[]> => {
  const raw = await postEnvelope<Record<string, unknown>[] | undefined>(
    '/enterprise/permissions-tree',
    {},
  );
  return (Array.isArray(raw) ? raw : []).map((g) => ({
    key: str(g.key),
    name: str(g.name),
    children: (Array.isArray(g.children) ? g.children : []).map((c) => {
      const o = c as Record<string, unknown>;
      return { key: str(o.key), name: str(o.name) };
    }),
  }));
};

/* ---------- 某个角色的权限 ---------- */

/**
 * 后端存的形状是 `{ [key]: { checked: boolean } }`,前端用 Set 更好算。
 * 只收 `checked === true` 的键 —— 其余一律当没勾。
 */
export function toSelectedSet(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === 'owner') continue;
    if (v === true) out.add(k);
    else if (v && typeof v === 'object' && (v as { checked?: boolean }).checked === true)
      out.add(k);
  }
  return out;
}

/**
 * 读某个角色的权限。
 *
 * ⚠️ **参数是驼峰 `roleId`**,而写回去的 `permissions/manage` 是蛇形 `role_id` ——
 * 同一个模块两套写法,改一个字母就 422。对外只暴露驼峰,映射在这一层做完。
 *
 * 另外它**有副作用**:角色在企业下不存在但属于四个内置角色之一时,
 * 后端会顺手把它 create 出来再返回(`getRolePermission` 里那段 for 循环)。
 */
export const getRolePermissions = async (roleId: string): Promise<Set<string>> =>
  toSelectedSet(await postEnvelope<unknown>('/enterprise/permissions/show', { roleId }));

/** 写回去的形状:后端存 `{ [key]: { checked } }`,**没勾的也要写 false** */
export function serializePermissions(tree: PermGroup[], selected: Set<string>) {
  const out: Record<string, { checked: boolean }> = {};
  for (const g of tree) {
    for (const leaf of g.children) out[leaf.key] = { checked: selected.has(leaf.key) };
  }
  return out;
}

/* ---------- 分组的三态 ---------- */

export type GroupState = 'none' | 'some' | 'all';

/** 一组里勾了几个 —— 决定分组复选框是空、半选还是全选 */
export function groupState(g: PermGroup, selected: Set<string>): GroupState {
  if (!g.children.length) return 'none';
  const n = g.children.filter((c) => selected.has(c.key)).length;
  return n === 0 ? 'none' : n === g.children.length ? 'all' : 'some';
}

/** 整组勾上/取消 */
export function toggleGroup(g: PermGroup, selected: Set<string>, on: boolean): Set<string> {
  const next = new Set(selected);
  for (const c of g.children) {
    if (on) next.add(c.key);
    else next.delete(c.key);
  }
  return next;
}

export function toggleLeaf(key: string, selected: Set<string>): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/* ---------- 角色能做什么 ---------- */

/**
 * 四个**内置角色**。后端 `OrgRoles` 常量,`checkDefaultRole` 拿它挡删除,
 * 而且是**按 id 或名字**比 —— 所以自建一个叫「管理员」的角色也会删不掉。
 */
export const BUILTIN_ROLES = [
  { roleId: 'owner', roleName: '拥有者' },
  { roleId: 'admin', roleName: '管理员' },
  { roleId: 'leader', roleName: '部门主管' },
  { roleId: 'user', roleName: '普通员工' },
] as const;

const BUILTIN_IDS = new Set<string>(BUILTIN_ROLES.map((r) => r.roleId));
const BUILTIN_NAMES = new Set<string>(BUILTIN_ROLES.map((r) => r.roleName));

export interface RoleCapabilities {
  canRename: boolean;
  canEditPermissions: boolean;
  canDelete: boolean;
  /** 不能改/不能删时给用户看的原因 */
  reason?: 'owner' | 'builtin' | 'virtual';
}

/**
 * 这个角色能做什么。三种受限:
 *
 * - **`owner`**:后端第一行就拒(`role_id === 'owner' || role_name === '拥有者'`),
 *   改名、改权限、删除全不行。
 * - **内置角色**(admin / leader / user):权限可以改,但**删不掉** ——
 *   `checkDefaultRole` 按 id **或名字**比对。
 * - **虚拟角色 `none`**(「未分配」):它压根不在角色表里,什么都做不了。
 */
export function roleCapabilities(roleId: string, roleName = ''): RoleCapabilities {
  if (roleId === 'owner' || roleName === '拥有者') {
    return { canRename: false, canEditPermissions: false, canDelete: false, reason: 'owner' };
  }
  if (roleId === VIRTUAL_ROLE_ID) {
    return { canRename: false, canEditPermissions: false, canDelete: false, reason: 'virtual' };
  }
  if (BUILTIN_IDS.has(roleId) || BUILTIN_NAMES.has(roleName)) {
    return { canRename: true, canEditPermissions: true, canDelete: false, reason: 'builtin' };
  }
  return { canRename: true, canEditPermissions: true, canDelete: true };
}

/* ---------- 增删改 ---------- */

/**
 * ⚠️ **`update` 是全量覆盖,不是 patch。**
 *
 * 后端 `roleUpdate` 是 `updateOne({uid, role_id}, { role_name, permissions })` ——
 * 两个字段一起写。所以**改名时必须把当前权限一起传回去,存权限时必须把当前名字
 * 一起传回去**,少传一个就有把它写没的风险。
 *
 * 这也是为什么这里只暴露一个 `saveRole(roleId, name, permissions)`,
 * 而不是分成 renameRole / savePermissions 两个 —— 拆开就等于给人留了个漏传的坑。
 */
export const saveRole = (roleId: string, roleName: string, permissions: Record<string, unknown>) =>
  postEnvelopeFull<unknown>('/enterprise/permissions/manage', {
    action: 'update',
    role_id: roleId,
    role_name: roleName.trim(),
    permissions,
  });

/** 新建角色。后端查重名,回 `{ id }` */
export const createRole = (roleName: string) =>
  postEnvelopeFull<{ id?: string }>('/enterprise/permissions/manage', {
    action: 'add',
    role_name: roleName.trim(),
  });

/** 删角色。后端挡内置角色(按 id 或名字比) */
export const deleteRole = (roleId: string) =>
  postEnvelopeFull<unknown>('/enterprise/permissions/manage', {
    action: 'delete',
    role_id: roleId,
  });

/* ---------- 角色下的成员 ---------- */

/**
 * 某个角色下的成员。
 *
 * ⚠️ 参数是**驼峰 `roleId`**(与 `permissions/show` 一致,与 `permissions/manage` 相反)。
 *
 * 虚拟角色 `none` 在**这里是能用的** —— 后端专门写了
 * `if (roleId === 'none') roleId = null`,查的是 `role_id: null` 的人。
 * 别和「不能把人的角色**设成** none」混为一谈:读可以,写不行。
 */
export const listRoleMembers = (roleId: string, q: Partial<PageQuery>) =>
  pagedPost<MemberRow>('/enterprise/role-user-list', { ...q }, normalizeMemberRow, { roleId });
