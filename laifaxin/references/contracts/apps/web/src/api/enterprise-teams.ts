import { postEnvelope, postEnvelopeFull } from '@/api/auth';
import { type PageQuery, pagedPost, type TeamNode } from '@/api/enterprise-members';

/**
 * 组织架构:部门树 + 邀请链接 + 加入审批。
 *
 * 部门树的读取(`getTeamTree` / `flattenTeams` / `normalizeTeamNode`)在
 * `enterprise-members.ts` —— 成员表要按部门筛,先落在那里了,这里只补写操作。
 */

/* ---------- 部门增删改 ---------- */

export type TeamAction = 'add' | 'update' | 'delete';

/**
 * 部门名的唯一范围是**整个企业**,不是同级。
 *
 * 后端索引就是这么建的:`@index({ uid: 1, team_name: 1 }, { unique: true })`,
 * 查重也是 `countDocuments({ uid, team_name })`。所以
 * 「华东区/销售组」和「华南区/销售组」**建不出来** —— 这不是 bug 是设计,
 * 但界面上必须说清楚,否则用户会反复试同一个名字。
 *
 * ⚠️ 更麻烦的是**后端只在 `add` 分支查重,`update` 分支不查** ——
 * 改名撞上已有名字会直接撞唯一索引 500。所以改名前必须在前端自己查一遍,
 * 见 {@link findTeamByName}。
 */
export function findTeamByName(
  root: TeamNode | null,
  name: string,
  excludeId?: string,
): TeamNode | null {
  if (!root) return null;
  const want = name.trim();
  const walk = (n: TeamNode): TeamNode | null => {
    if (n.id !== excludeId && n.name === want) return n;
    for (const c of n.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  // 根节点是企业本身,不是部门,不参与查重
  for (const c of root.children) {
    const hit = walk(c);
    if (hit) return hit;
  }
  return null;
}

/** 一个节点及其全部后代的 id */
export function collectDescendantIds(node: TeamNode): string[] {
  return [node.id, ...node.children.flatMap(collectDescendantIds)];
}

/** 从企业到目标部门的路径，也用于编辑时保留原上级。 */
export function findTeamPath(root: TeamNode | null, id: string): TeamNode[] {
  if (!root) return [];
  if (root.id === id) return [root];
  for (const child of root.children) {
    const path = findTeamPath(child, id);
    if (path.length) return [root, ...path];
  }
  return [];
}

/** 搜索时保留匹配部门的祖先；匹配父部门时展示其完整子树。 */
export function filterTeamTree(root: TeamNode | null, keyword: string): TeamNode | null {
  if (!root) return null;
  const value = keyword.trim().toLocaleLowerCase();
  if (!value || root.name.toLocaleLowerCase().includes(value)) return root;
  const children = root.children
    .map((child) => filterTeamTree(child, value))
    .filter((child): child is TeamNode => child !== null);
  return children.length ? { ...root, children } : null;
}

/**
 * 这个节点能不能当那个节点的上级。
 *
 * ⚠️ **后端只挡了 `team_id === father`(父节点是自己),没有做祖先环检查。**
 * 也就是说把 A 的上级设成 A 的子节点,后端照收 —— 树上就出现了一个环,
 * 之后 `getTeamChilren` 递归下去会栈溢出,整个部门接口挂掉。
 *
 * 所以上级选择器必须把**自己和自己的全部后代**都禁掉,提交前再校验一次。
 */
export function canBeParent(candidate: TeamNode, moving: TeamNode): boolean {
  return !collectDescendantIds(moving).includes(candidate.id);
}

export interface TeamDraft {
  /** 改和删要;新建不用 */
  teamId?: string;
  name: string;
  /** 上级 id。顶级是 '0' */
  father: string;
}

/**
 * 增删改都走这一个接口,靠 `action` 分流。
 *
 * 后端在 delete 分支挡了三种,都是 `success:false` + 中文:
 * 顶级部门('0')不能删、有子部门要先删子部门、有成员要先移走成员。
 * 这几句原样转给用户 —— 它们已经把「下一步该做什么」说清楚了。
 *
 * 字段名注意:这里是**蛇形 `team_id` / `team_name`**,而
 * `teams/profile-show` 与 `teams/user-list` 那边又是驼峰 `teamId`。
 * 同一个模块两套写法,映射在这一层做完,对外只有驼峰。
 */
export function manageTeam(action: TeamAction, d: TeamDraft) {
  const body: Record<string, unknown> = { action };
  if (action !== 'add') body.team_id = d.teamId;
  if (action !== 'delete') {
    body.team_name = d.name.trim();
    body.father = d.father;
  }
  return postEnvelopeFull<unknown>('/enterprise/teams/manage', body);
}

/* ---------- 邀请设置 ---------- */

export interface InviteSetting {
  /** 通过链接加入的人默认拿什么角色。后端拒绝 'owner' */
  inviteRole: string;
  /** 要不要人工审批 */
  inviteAudit: boolean;
  /** 链接过期时间,**绝对毫秒时间戳**;0 = 永久有效 */
  expireTime: number;
}

/**
 * 保存邀请设置。
 *
 * ⚠️ **字段是 `expireTime`,不是 `expire_time`。** 老项目发的是后者
 * (`profile/changeinviteForm.tsx:44`),后端读不到 —— 于是**改有效期是静默失效的**:
 * 界面提示保存成功,实际那个值从来没变过。这大概是这个模块里最难被发现的一个 bug,
 * 因为它不报错、只是什么都没发生。
 *
 * 另外它是**三字段全量覆盖**,不是 patch:后端把三个值原样写进企业文档。
 * 所以调用方必须把当前值一起传回来,不能只传改动的那个。
 */
export function saveInviteSetting(s: InviteSetting) {
  return postEnvelopeFull<unknown>('/enterprise/invite-setting-save', {
    inviteRole: s.inviteRole,
    inviteAudit: s.inviteAudit,
    expireTime: s.expireTime,
  });
}

/** 天数 → 绝对毫秒时间戳。0 天表示永久,对应后端的 0 */
export const expireAtFromDays = (days: number, now = Date.now()): number =>
  days <= 0 ? 0 : now + days * 24 * 3600 * 1000;

/** 重新生成邀请码。旧链接立刻失效 */
export const renewInviteLink = () => postEnvelope<unknown>('/enterprise/invite-link-renew', {});

/* ---------- 邀请链接 ---------- */

/**
 * 拼邀请链接。
 *
 * ⚠️ **查询参数用 `corpId`,而老项目两处生成端拼的都是 `corpld`(小写 L)** ——
 * `teams/invite.tsx:108` 和 `profile/companyInfo.tsx:88`,错拼是现役的不是历史遗留。
 * 接收端 `join/index.tsx:64` 写着 `web_corpId || web_corpld` 兜底,才没出事。
 *
 * 新项目生成一律用正确拼写;解析端 {@link parseInviteSearch} 两个都认 ——
 * 已经发出去的老链接不能因为这次迁移作废。
 */
export function buildInviteLink(orgId: string, inviteCode: string, origin = ''): string {
  const base = origin || (typeof window === 'undefined' ? '' : window.location.origin);
  return `${base}/enterprise/join?corpId=${encodeURIComponent(orgId)}&inviteCode=${encodeURIComponent(inviteCode)}`;
}

/** 从 query 里读出企业 id 与邀请码。`corpld` 只读不写,见上 */
export function parseInviteSearch(search: string | URLSearchParams): {
  orgId: string;
  inviteCode: string;
} {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  return {
    orgId: p.get('corpId') || p.get('corpld') || '',
    inviteCode: p.get('inviteCode') || '',
  };
}

/* ---------- 加入申请 ---------- */

export type AuditAction = 'pass' | 'refuse' | 'delete';

export interface JoinRequest {
  userid: string;
  nickname: string;
  email: string;
  /** 后端存的是数字状态,9 = 已拒绝 */
  status: number;
  createTime: number;
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : d;
};

export const REFUSED_STATUS = 9;

export function normalizeJoinRequest(r: Record<string, unknown>): JoinRequest {
  return {
    userid: str(r.userid),
    nickname: str(r.nickname),
    email: str(r.email),
    status: num(r.status),
    createTime: num(r.create_time),
  };
}

/**
 * 待审批的加入申请。
 *
 * 路径拼写是 **`invite-link-requst`**(少一个 e)—— 后端就是这么写的,照抄。
 * 响应形状与 `members/show` 一样:`total`/`current` 是 `data` 的兄弟,
 * 所以复用 {@link pagedPost}。
 */
export const listJoinRequests = (q: Partial<PageQuery>) =>
  pagedPost<JoinRequest>('/enterprise/invite-link-requst', q, normalizeJoinRequest);

/**
 * 审批。三个动作:
 * - `pass` 通过
 * - `refuse` 拒绝(把申请记录的 status 置 9,记录还在)
 * - `delete` 直接删掉申请记录
 */
export const auditJoinRequest = (userid: string, action: AuditAction) =>
  postEnvelopeFull<unknown>('/enterprise/invite-link-audit', { userid, action });
