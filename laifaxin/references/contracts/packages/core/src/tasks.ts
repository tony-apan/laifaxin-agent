import { type Relation, toRelations } from './follow';
/**
 * 任务日程。一条任务 = 标题 + 起止时间 + 优先级 + 关联的联系人/公司,
 * 落在日历上按天铺开。任务的另一个来源是跟进记录的「下次跟进」({@link file://./follow.ts})。
 *
 * 与老项目的差异,每条都是照着后端源码定的:
 *
 * - **高优先级在线上是拼错的 `hight`**。后端实体注释写着 `// low medium hight`,
 *   `TaskCreateInput` 的文档却写 `enum: ['low','medium','high']` —— 而那条 Joi 规则是裸的
 *   `RuleType.string()`,根本不校验,所以文档是错的、库里存的是 `hight`。
 *   老前端从选择器到读取全程用 `hight`,是自洽的。这里**只在这一层用错的拼写**,
 *   业务代码一律用 {@link TaskPriority} 的 `high`,跟 `data/sentinels.ts` 里
 *   `UNKNOWN = 'unkown'` 同一个路数。
 *
 * - **不再往库里灌前端字段**。`recordService.taskAdd/taskSave` 是
 *   `{...params}` 直接 spread 进 mongo 模型的,老前端于是把 `textColor`(算出来的颜色)、
 *   `allDay`、`dueDateTime`(表单里的日期区间数组)全写进了数据库。
 *   这里每个提交体都显式列字段,见 {@link taskBody}。
 *
 * - **增删改都只回 `{success:true}`,不带数据**,所以改完必须重新拉。
 */

/* ---------- 枚举 ---------- */

/** 旧项目任务页支持七种类型；跟进记录快捷创建只提供其中三种。 */
export const TASK_TYPES = [
  'todo',
  'call',
  'email',
  'meeting',
  'linkedin',
  'whatsapp',
  'other',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

/** 优先级,业务代码里用这三个值 */
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * 线上的高优先级拼错了,少一个 h 多一个 t。
 * 只有 {@link toPriority} 和 {@link fromPriority} 认识它,别处不要出现这个字符串。
 */
const WIRE_HIGH = 'hight';

/** 线上值 → 业务值 */
export const toPriority = (v: unknown): TaskPriority => {
  if (v === WIRE_HIGH || v === 'high') return 'high';
  if (v === 'medium') return 'medium';
  return 'low';
};

/** 业务值 → 线上值 */
export const fromPriority = (p: TaskPriority): string => (p === 'high' ? WIRE_HIGH : p);

/**
 * 状态。后端 DTO 里还允许 `'canceled'`,但老项目从头到尾没有任何入口能写出这个值,
 * 界面上也只有「未完成 / 已完成」两态 —— 所以这里当它不存在,读到就归到未完成。
 */
export type TaskStatus = '' | 'finished';

export const isFinished = (v: unknown): boolean => v === 'finished';

/* ---------- 数据形状 ---------- */

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  /** 起止时间,毫秒时间戳 */
  start: number;
  end: number;
  /** 归属人 userid —— 界面上的「负责人」就是它 */
  userid: string;
  /** 创建人 userid。与归属人不是一回事:任务可以建给别人 */
  creator: string;
  contactIds: string[];
  companyIds: string[];
  /** 提醒时间戳,0 = 不提醒 */
  remindTime: number;
  create_time?: number;
  relations?: Relation[];
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

export const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * 归一化。**结束时间兜底成开始时间** —— 库里 `start`/`end` 都是可空的,
 * 老数据里有只填了 start 的,end 为 0 时日历会把它画成 1970 年那一格。
 */
export function toTask(r: Record<string, unknown>): Task {
  // 跟进记录附带创建的任务只保存 timestamp，独立任务使用 start/end。
  const start = num(r.start) || num(r.timestamp);
  const end = num(r.end);
  const relations = toRelations(r);
  for (const kind of ['contact', 'company'] as const) {
    for (const id of ids(r[kind === 'contact' ? 'contactIds' : 'companyIds'])) {
      if (!relations.some((item) => item.kind === kind && item.id === id)) {
        relations.push({ kind, id, label: id });
      }
    }
  }
  return {
    id: str(r._id) || str(r.id),
    title: str(r.title),
    description: str(r.description),
    type: (TASK_TYPES as readonly string[]).includes(str(r.type)) ? (r.type as TaskType) : 'todo',
    priority: toPriority(r.priority),
    status: isFinished(r.status) ? 'finished' : '',
    start,
    end: end >= start ? end : start,
    userid: str(r.userid),
    creator: str(r.creator),
    contactIds: ids(r.contactIds),
    companyIds: ids(r.companyIds),
    remindTime: num(r.remindTime),
    create_time: num(r.create_time),
    relations,
  };
}

/* ---------- 编辑 ---------- */

export interface TaskDraft {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  start: number;
  end: number;
  userid: string;
  contactIds: string[];
  companyIds: string[];
  /** Undefined leaves an existing reminder unchanged; 0 explicitly disables it. */
  remindTime?: number;
  /** 仅供表单展示,提交时只发送两种业务 id。 */
  relations?: Relation[];
  creator?: string;
}

/** 新建任务的默认值:当天 09:00 → 18:00 */
export function emptyTaskDraft(day: number, userid: string): TaskDraft {
  const d = new Date(day);
  const at = (h: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0).getTime();
  return {
    id: '',
    title: '',
    description: '',
    type: 'todo',
    priority: 'low',
    status: '',
    start: at(9),
    end: at(18),
    userid,
    contactIds: [],
    companyIds: [],
    remindTime: 0,
  };
}

export const draftFromTask = (t: Task): TaskDraft => ({
  id: t.id,
  title: t.title,
  description: t.description,
  type: t.type,
  priority: t.priority,
  status: t.status,
  start: t.start,
  end: t.end,
  userid: t.userid,
  contactIds: t.contactIds,
  companyIds: t.companyIds,
  remindTime: t.remindTime,
  relations: t.relations,
  creator: t.creator,
});

/**
 * 提交体。**字段是显式列出来的,不是把表单对象整个发过去** ——
 * 后端 service 会把请求体 spread 进 mongo 模型,发什么就存什么。
 * 老项目正是这样把 `textColor` / `allDay` / `dueDateTime` 写进了数据库。
 *
 * `creator` 不发:新增时后端用当前登录人覆盖,保存时后端 `delete params.creator`,
 * 发了也是白发。
 */
export function taskBody(d: TaskDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: d.title.trim(),
    description: d.description,
    type: d.type,
    priority: fromPriority(d.priority),
    start: d.start,
    end: d.end,
    contactIds: d.contactIds,
    companyIds: d.companyIds,
  };
  // 归属人只有企业号能改。个人号发空串会被后端 `if (!params.userid) delete` 丢掉,
  // 但那是碰巧成立 —— 这里干脆不发
  if (d.userid) body.userid = d.userid;
  // 状态只在编辑时有意义,新建的任务一定是未完成
  if (d.id) body.status = d.status;
  if (d.remindTime !== undefined) body.remindTime = d.remindTime;
  return body;
}

/* ---------- 校验 ---------- */

export function validateTask(d: TaskDraft) {
  const e: { title?: string; time?: string; reminder?: string } = {};
  if (!d.title.trim()) e.title = 'tk.errTitle';
  // 后端 title 是 `.required().min(1).max(256)`,超了会 422
  else if (d.title.trim().length > 256) e.title = 'tk.errTitleLong';
  if (!Number.isFinite(d.start) || !Number.isFinite(d.end) || d.start <= 0 || d.end <= 0)
    e.time = 'tk.errTimeRequired';
  else if (d.end < d.start) e.time = 'tk.errTimeOrder';
  if (d.remindTime !== undefined && !validTaskReminder(d.remindTime)) e.reminder = 'tk.errReminder';
  return e;
}

/** A reminder is an absolute timestamp, not a duration relative to task start. */
export const validTaskReminder = (value: number) =>
  value === 0 || (value > 0 && Number.isFinite(new Date(value).getTime()));
