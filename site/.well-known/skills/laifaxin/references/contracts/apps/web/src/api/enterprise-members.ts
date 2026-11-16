import { postEnvelope, postEnvelopeFull } from '@/api/auth';

/**
 * 企业成员。
 *
 * 后端在 `laifaxin-server/src/controller/enterprise.ts`。这一层把六件容易出事的
 * 收敛掉,每一条下面都写了后端是怎么做的。
 */

/* ---------- 分页 ---------- */

/**
 * 列表接口的分页参数。**约束来自后端 `dto/common.dto.ts` 的 `TableDataInput`**:
 * `current` 必填 1..1000000，`pageSize` 必填 1..100。
 */
export const PAGE_MIN = 1;
export const PAGE_MAX = 100;

export interface PageQuery {
  current: number;
  pageSize: number;
  filter?: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
}

/** 夹到后端认的范围。页面不许自己拼这些数字 —— 越界是 422,不是空列表 */
export function clampPage(q: Partial<PageQuery>): PageQuery {
  const pageSize = Math.min(PAGE_MAX, Math.max(PAGE_MIN, Math.trunc(q.pageSize ?? 20) || 20));
  const current = Math.max(1, Math.trunc(q.current ?? 1) || 1);
  return { current, pageSize, filter: q.filter, sort: q.sort };
}

export interface PagedResult<T> {
  rows: T[];
  total: number;
  current: number;
}

/**
 * 分页请求。
 *
 * ⚠️ **`total` 和 `current` 是 `data` 的兄弟,不在 `data` 里面。**
 * 后端写的是 `return { ...data, success, message }`,而 `data` 本身是
 * `{ data, current, total }` —— 摊平之后响应长这样:
 *
 * ```json
 * { "data": [...], "current": 1, "total": 87, "success": true }
 * ```
 *
 * 老项目五处列表全都写成 `rowCount={rows.length}`,于是**总页数永远是 1**,
 * 第二页之后的成员根本翻不到。这是整个企业模块里影响面最大的一个 bug。
 * 所以这里必须拿整个信封({@link postEnvelopeFull}),不能只取 data。
 */
export async function pagedPost<T>(
  path: string,
  q: Partial<PageQuery>,
  map: (r: Record<string, unknown>) => T,
  /** 分页之外的额外字段(如 role-user-list 的 roleId) */
  extra?: Record<string, unknown>,
): Promise<PagedResult<T>> {
  const body = clampPage(q);
  const res = await postEnvelopeFull<Record<string, unknown>[]>(path, { ...body, ...extra });
  const env = res as unknown as Record<string, unknown>;
  const rows = Array.isArray(res.data) ? res.data : [];
  return {
    rows: rows.map((r) => map(r as Record<string, unknown>)),
    total: typeof env.total === 'number' ? env.total : rows.length,
    current: typeof env.current === 'number' ? env.current : body.current,
  };
}

/* ---------- 成员状态 ---------- */

/**
 * 四态。后端存在 `enterpriseUserModel.status` 上。
 *
 * - `ok` 正常
 * - `pending` 待审核(受邀或申请加入,还没通过)
 * - `disabled` 已停用
 * - `exiting` 退出中(本人点了「退出企业」,`memeberQuit` 把状态改成这个)
 *
 * ⚠️ 后端 `getUserPermissionsFromDb` 对**除 `ok` 以外的所有状态**都直接回 `{}`,
 * 也就是说 pending / disabled / exiting 三种人的权限全是空的。
 */
export const MEMBER_STATUSES = ['ok', 'pending', 'disabled', 'exiting'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const isMemberStatus = (v: string): v is MemberStatus =>
  (MEMBER_STATUSES as readonly string[]).includes(v);

/* ---------- 行 ---------- */

export interface MemberRow {
  userid: string;
  nickname: string;
  email: string;
  phone: string;
  avatar: string;
  roleId: string;
  /** 后端下发中文;取不到时是哨兵,见 {@link ROLE_UNKNOWN} */
  roleName: string;
  /** 所属部门 id 列表 */
  teams: string[];
  /** 后端的部门名数组，归一为展示文本。 */
  teamsName: string;
  status: MemberStatus | string;
  createTime: number;
}

/**
 * 角色取不到时后端塞进 `role_name` 的中文字面量。
 *
 * 注意**两个接口的哨兵不一样**:`my-organies` 用的是「角色不存在」
 * (见 `api/enterprise.ts` 的 `ROLE_MISSING`),这里的 `getRoleName` 用的是这个。
 * 两个都要判掉,不然界面上会冒出这几个字当角色名。
 */
export const ROLE_UNKNOWN = '未知角色';

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : d;
};

export function normalizeMemberRow(r: Record<string, unknown>): MemberRow {
  return {
    userid: str(r.userid),
    nickname: str(r.nickname),
    email: str(r.email),
    phone: str(r.phone),
    avatar: str(r.avatar),
    roleId: str(r.role_id),
    roleName: str(r.role_name),
    teams: Array.isArray(r.teams) ? r.teams.filter((x): x is string => typeof x === 'string') : [],
    teamsName: Array.isArray(r.teamsName)
      ? r.teamsName.filter((name): name is string => typeof name === 'string' && !!name).join(' / ')
      : str(r.teamsName),
    status: str(r.status, 'ok'),
    createTime: num(r.create_time),
  };
}

/** 角色名能不能直接给人看 */
export const hasRealRoleName = (name: string) => !!name && name !== ROLE_UNKNOWN;

export interface MemberFilter {
  /** 企业昵称模糊匹配；邮箱是查询后关联的字段，不能通过这个接口筛选。 */
  keyword?: string;
  status?: MemberStatus;
  /** 只看某个部门 */
  teamId?: string;
  /** 当前部门及其下级部门；由部门树构造，成员在多个部门时只返回一行。 */
  teamIds?: string[];
}

/**
 * 成员列表。
 *
 * ⚠️ **`filter` 会被后端原样并进 mongo 查询**(`getMembersListByQuery({...filter, uid})`),
 * 所以这里只允许构造白名单形状,绝不能把界面状态整个丢进去 ——
 * 那等于把 mongo 查询的写权限交给前端。
 */
export const listMembers = (q: Omit<Partial<PageQuery>, 'filter'> & { filter?: MemberFilter }) =>
  pagedPost<MemberRow>(
    '/enterprise/members/show',
    {
      ...q,
      filter: {
        ...(q.filter?.keyword?.trim()
          ? { nickname: { $regex: q.filter.keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } }
          : {}),
        ...(q.filter?.status ? { status: q.filter.status } : {}),
        ...(q.filter?.teamIds
          ? {
              teams: {
                $in: [
                  ...new Set(q.filter.teamIds.filter((id) => typeof id === 'string' && id !== '0')),
                ],
              },
            }
          : q.filter?.teamId
            ? { teams: q.filter.teamId }
            : {}),
      },
      sort: q.sort ?? { create_time: -1 },
    },
    normalizeMemberRow,
  );

/* ---------- 改 ---------- */

/**
 * 改成员资料。**只发白名单字段。**
 *
 * 后端是 `updateOne({uid,userid}, {...params})` —— 请求体整个 spread 进去,
 * 而框架开了 `allowUnknown`。也就是说多发一个 `status` 就能把人停用、
 * 多发一个 `role_id` 就能给自己升权限。老项目那种 `{...form}` 的写法离这只差一步。
 *
 * DTO 上只声明了 `nickname`(≤64),所以这里也只发它。
 */
export const modifyMember = (userid: string, nickname: string) =>
  postEnvelope<unknown>('/enterprise/members/modify', { userid, nickname: nickname.trim() });

/**
 * 停用 / 启用。
 *
 * ⚠️ **这是翻转,不是设置**,而且翻得不对称:
 *
 * ```js
 * let save = 'ok';
 * if (status === 'ok') save = 'disabled';   // ok → disabled;其余一律 → ok
 * ```
 *
 * 所以对一个 `pending`(待审核)或 `exiting`(退出中)的人点一下,
 * 他会**直接变成正式成员** —— 审核流程被绕过去了。
 * 请求体里那个 `action` 字段后端根本不看,别以为传了就是 set。
 *
 * 结论:**只对 `ok` 和 `disabled` 两种状态渲染这个按钮**,见 {@link canToggleStatus}。
 */
export const toggleMemberStatus = (userid: string) =>
  postEnvelope<unknown>('/enterprise/members/disable', { userid });

/** 能不能对这个人用「停用/启用」。pending 与 exiting 不行,理由见上 */
export const canToggleStatus = (status: string) => status === 'ok' || status === 'disabled';

/**
 * 删除成员。**这个才是真的不可逆** —— 后端 `memberDelete` 是
 * `deleteOne` + 删加入日志 + `resetUserData(uid, userid)`,
 * 最后那步会把这个人名下的**客户与公司数据一并重置**。
 *
 * 别和「退出企业」搞混:那个是软退出(status 改成 exiting),记录还在。
 */
export const deleteMember = (userid: string) =>
  postEnvelopeFull<unknown>('/enterprise/members/delete', { userid });

/**
 * 换角色。
 *
 * 后端字段是**蛇形 `role_id`**(而 `permissions/show` 那边又是驼峰 `roleId`,
 * 同一个模块两种写法)。对外只暴露驼峰,映射在这一层做完。
 *
 * 后端会挡两种:不能改成 `owner`、不能改企业所有者的角色,都是 success:false + 中文。
 */
export const changeMemberRole = (userid: string, roleId: string) =>
  postEnvelopeFull<unknown>('/enterprise/role/change', { userid, role_id: roleId });

/** 换部门。后端收的是 id 数组 */
export const changeMemberTeams = (userid: string, teams: string[]) =>
  postEnvelopeFull<unknown>('/enterprise/teams/change', { userid, teams });

/* ---------- 角色 ---------- */

export interface RoleItem {
  roleId: string;
  roleName: string;
  /** 这个角色下有多少人 */
  users: number;
}

/**
 * 后端在角色列表**末尾硬追加**的虚拟角色,表里并不存在。
 *
 * 它统计的是 `role_id: null` 的成员数,本意是「还没分配角色的人」。
 * 但它出现在下拉里就成了陷阱:选中它会把某人的 `role_id` 设成字符串 `'none'`,
 * 而后端 `getUserPermissionsFromDb` 拿 `'none'` 去查角色表查不到 → 回 `{}` →
 * **这个人所有权限被剥光**,界面上没有任何提示。
 * 更荒唐的是设成 `'none'` 之后他连「未分配」这一栏都不算了(那栏数的是 null)。
 *
 * 所以换角色的下拉必须把它滤掉,见 {@link assignableRoles}。
 */
export const VIRTUAL_ROLE_ID = 'none';
/** 企业所有者的角色 id。后端明确拒绝把人改成它 */
export const OWNER_ROLE_ID = 'owner';

export const listRoles = async (): Promise<RoleItem[]> => {
  const raw = await postEnvelope<Record<string, unknown>[] | undefined>(
    '/enterprise/roles-list',
    {},
  );
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    roleId: str(r.role_id),
    roleName: str(r.role_name),
    users: num(r.users),
  }));
};

/**
 * 能拿来给人分配的角色。滤掉两个:
 * - `none` 虚拟角色 —— 理由见 {@link VIRTUAL_ROLE_ID}
 * - `owner` —— 后端会拒,放在下拉里只会让人白点一次
 */
export const assignableRoles = (roles: RoleItem[]) =>
  roles.filter((r) => r.roleId !== VIRTUAL_ROLE_ID && r.roleId !== OWNER_ROLE_ID);

/* ---------- 部门树 ---------- */

export interface TeamNode {
  id: string;
  name: string;
  users: number;
  children: TeamNode[];
}

/**
 * 部门树。
 *
 * 形状上有两处要注意:
 * - **根节点是企业本身**(`key:'0'`,title 是企业名),不是一个真部门。
 * - 企业不存在时后端回 **`[]`**。老项目直接对它做 `Object.keys(...)` 会白屏,
 *   所以这里归一成 `null`,让调用方有个明确的空态可判。
 */
export function normalizeTeamNode(r: Record<string, unknown>): TeamNode {
  const kids = Array.isArray(r.children) ? r.children : [];
  return {
    id: str(r.key ?? r.value ?? r.team_id),
    name: str(r.title ?? r.team_name),
    users: num(r.users),
    children: kids.map((c) => normalizeTeamNode(c as Record<string, unknown>)),
  };
}

export const getTeamTree = async (): Promise<TeamNode | null> => {
  const raw = await postEnvelope<Record<string, unknown>[] | undefined>(
    '/enterprise/teams/show',
    {},
  );
  const list = Array.isArray(raw) ? raw : [];
  return list.length ? normalizeTeamNode(list[0]) : null;
};

/** 把树拍平成一行行,给下拉与「上级部门」选择器用 */
export function flattenTeams(
  root: TeamNode | null,
  depth = 0,
): { node: TeamNode; depth: number }[] {
  if (!root) return [];
  return [{ node: root, depth }, ...root.children.flatMap((c) => flattenTeams(c, depth + 1))];
}
