import type { UploadedFile } from './upload';
/**
 * 跟进记录。一条记录 = 一次跟进(类型 + 内容 + 发生时间 + 关联对象),
 * 可以顺带创建一个「下次跟进任务」。
 *
 * 与老项目的差异:
 * - **关联对象的两套主键在这一层收敛**:公司用 `_id`、联系人用 `cid`,
 *   对外统一成 `{ kind, id, label }`,业务代码里不再出现这两个名字
 * - **`taskTime` 整段重写**。老项目那段有四个 bug:编辑时把日期前缀拼了两次、
 *   两个档位把数组传进日期函数变成 NaN、不勾任务也照发 taskTime、选「自选日期」时
 *   反而什么都不发
 * - **时间线按发生时间分成「即将发生」与「已发生」两组**,`timestamp` 正好等于此刻的
 *   那条不再两边都落空(老项目两个过滤器都用严格比较,这一条会凭空消失)
 * - 列表请求里 `contactIds` / `companyIds` 是**单个字符串**,提交时才是数组 —— 后端如此
 */

/* ---------- 枚举 ---------- */

/** 跟进方式,7 种 */
export const FOLLOW_TYPES = [
  'note',
  'call',
  'email',
  'meeting',
  'linkedin',
  'whatsapp',
  'other',
] as const;

export type FollowType = (typeof FOLLOW_TYPES)[number];

export const isFollowType = (v: unknown): v is FollowType =>
  typeof v === 'string' && (FOLLOW_TYPES as readonly string[]).includes(v);

/** 下次跟进任务的类型,只有 3 种,与上面那 7 种不是一回事 */
export const TASK_TYPES = ['call', 'email', 'todo'] as const;

export type TaskType = (typeof TASK_TYPES)[number];

/** 「几天后跟进」的预设档位 */
export const TASK_PRESETS = [1, 3, 7, 14, 30] as const;

/* ---------- 关联对象 ---------- */

/** 公司主键是 `_id`,联系人是 `cid` —— 收敛到这里,别处不再关心 */
export interface Relation {
  kind: 'contact' | 'company';
  id: string;
  label: string;
}

export const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

export const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

/* ---------- 记录 ---------- */

export interface FollowAttachment {
  name: string;
  url: string;
  size: number;
}

export interface FollowRecord {
  id: string;
  type: FollowType;
  /** 正文是 HTML,渲染前必须消毒 */
  body: string;
  /** 发生时间,毫秒 */
  timestamp: number;
  userid: string;
  create_time: number;
  attachments: FollowAttachment[];
  taskCreate: boolean;
  taskType: TaskType;
  /** 下次跟进时间,毫秒;0 表示没有任务 */
  taskTime: number;
  relations: Relation[];
}

const toAttachment = (v: unknown): FollowAttachment => {
  const a = (v ?? {}) as Record<string, unknown>;
  return { name: str(a.name) || str(a.filename), url: str(a.url), size: num(a.size) };
};

export const toRelations = (r: Record<string, unknown>): Relation[] => [
  ...(Array.isArray(r.contacts) ? r.contacts : []).map((x): Relation => {
    const c = (x ?? {}) as Record<string, unknown>;
    return { kind: 'contact', id: str(c.cid), label: str(c.email) || str(c.cid) };
  }),
  ...(Array.isArray(r.companies) ? r.companies : []).map((x): Relation => {
    const c = (x ?? {}) as Record<string, unknown>;
    return {
      kind: 'company',
      id: str(c._id),
      label: str(c.orgName) || str(c.domain) || str(c._id),
    };
  }),
];

export const toRecord = (r: Record<string, unknown>): FollowRecord => ({
  id: str(r._id) || str(r.id),
  type: isFollowType(r.type) ? r.type : 'note',
  body: str(r.body),
  timestamp: num(r.timestamp),
  userid: str(r.userid),
  create_time: num(r.create_time),
  attachments: Array.isArray(r.attachments) ? r.attachments.map(toAttachment) : [],
  taskCreate: r.taskCreate === true,
  taskType: (TASK_TYPES as readonly string[]).includes(str(r.taskType))
    ? (r.taskType as TaskType)
    : 'todo',
  taskTime: num(r.taskTime),
  relations: toRelations(r),
});

export interface FollowQuery {
  current: number;
  pageSize: number;
  /** 挂在哪个对象下。联系人传 cid、公司传 _id */
  subject: Relation;
  /** 空数组 = 不限类型 */
  types: FollowType[];
  keyword: string;
}

/* ---------- 新建 / 编辑 ---------- */

export interface FollowDraft {
  /** 空 = 新建 */
  id: string;
  type: FollowType;
  body: string;
  /** 发生时间,毫秒 */
  timestamp: number;
  relations: Relation[];
  attachments: UploadedFile[] | FollowAttachment[];
  /** 从附件库里勾的 id。本项目暂不提供附件库入口,保留字段 */
  attIds: string[];
  taskCreate: boolean;
  taskType: TaskType;
  /** 下次跟进时间,毫秒 */
  taskTime: number;
}

/** 默认三天后的同一时刻 */
export const defaultTaskTime = (now = Date.now()) => now + 3 * 24 * 3600 * 1000;

export const emptyFollowDraft = (subject: Relation, now = Date.now()): FollowDraft => ({
  id: '',
  type: 'note',
  body: '',
  timestamp: now,
  // 打开就默认关联当前这个对象
  relations: [subject],
  attachments: [],
  attIds: [],
  taskCreate: false,
  taskType: 'todo',
  taskTime: defaultTaskTime(now),
});

export const draftFromRecord = (r: FollowRecord): FollowDraft => ({
  id: r.id,
  type: r.type,
  body: r.body,
  timestamp: r.timestamp,
  relations: r.relations,
  attachments: r.attachments,
  attIds: [],
  taskCreate: r.taskCreate,
  taskType: r.taskType,
  taskTime: r.taskTime || defaultTaskTime(),
});

/**
 * 提交体。**不勾任务就不下发 taskTime** —— 老项目无论勾没勾都发,
 * 而且编辑分支把日期前缀拼了两次(`${今天} ${今天} ${时间}`)。
 */
export function followBody(d: FollowDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contactIds: d.relations.filter((r) => r.kind === 'contact').map((r) => r.id),
    companyIds: d.relations.filter((r) => r.kind === 'company').map((r) => r.id),
    body: d.body,
    attachments: d.attachments,
    attIds: d.attIds,
    type: d.type,
    timestamp: d.timestamp,
    taskCreate: d.taskCreate,
  };
  if (d.taskCreate) {
    body.taskType = d.taskType;
    body.taskTime = d.taskTime;
  }
  if (d.id) body.id = d.id;
  return body;
}

/* ---------- 校验与分组 ---------- */

/** 富文本里还挂着没传完的图片 —— 直接提交会存下一个失效的 blob: 地址 */
export const hasPendingImage = (html: string) =>
  html.includes('src="blob:') || html.includes('src="data:');

/** 返回 i18n key */
export function validateFollow(d: FollowDraft, htmlEmpty: boolean) {
  const e: { body?: string; relations?: string; taskTime?: string } = {};
  if (htmlEmpty) e.body = 'fr.errBodyEmpty';
  else if (hasPendingImage(d.body)) e.body = 'fr.errImagePending';
  if (d.relations.length === 0) e.relations = 'fr.errNoRelation';
  if (d.taskCreate && !(d.taskTime > 0)) e.taskTime = 'fr.errTaskTime';
  return e;
}

/**
 * 按发生时间分两组。老项目两个过滤器分别用 `>` 和 `<`,
 * `timestamp` 正好等于此刻的那条两边都不落,凭空消失。
 */
export function groupByTime(list: FollowRecord[], now = Date.now()) {
  const upcoming = list.filter((r) => r.timestamp > now).sort((a, b) => a.timestamp - b.timestamp);
  const done = list.filter((r) => r.timestamp <= now).sort((a, b) => b.timestamp - a.timestamp);
  return { upcoming, done };
}
