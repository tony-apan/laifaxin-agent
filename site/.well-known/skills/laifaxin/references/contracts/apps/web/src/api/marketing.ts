import { postEnvelope, postEnvelopeFull } from '@/api/auth';
import type { ContactRow, TagAction } from '@/api/crm';
import type { PageResult } from '@/api/expenses';
import type { TimeWindows } from '@/api/sending';

/**
 * 邮件营销:邮件群发 / 邮件追踪 / 智能跟进计划。
 *
 * 三页共用的口径(与老项目逐条核对过,别顺手"统一"):
 * - 分页参数是 **current + pageSize**(current 从 1 起),不是 page/size;
 *   响应里也回 `current`,老项目靠它把页码同步回去
 * - `sort` 是**对象**不是数组:`{ 字段: -1 | 1 }`(Mongo 风格,-1 降序)
 * - 时间一律是**毫秒数**
 *
 * 三个模块之间不一致的地方(最容易踩):
 * - 群发任务主键 `gtid`(单数),批量操作参数是复数 `gtids`
 * - 计划行主键是 `_id`,但所有写操作的请求体字段叫 `id`;
 *   而 step-list 又叫 `seqId` —— 同一个 ID 三个名字
 * - **`channel` 在两个模块里类型都不一样**:群发是数字(1=我的邮箱 / 2=系统通道),
 *   计划是字符串('self' / 'system')。共用一个类型会错
 */

/* ---------- 邮件群发 ---------- */

/**
 * 老项目的状态枚举,Tab 的 value 直接就是 filter.status。
 * 注意 `continue`:老项目给它配了颜色却漏了中文映射,界面上会直接漏出英文
 * (marketing-cells.tsx:53 有分支、:62-75 的文案链没有)。这里补齐。
 */
export const MASS_STATUSES = [
  'total',
  'running',
  'schedule',
  'waiting',
  'paused',
  'finished',
  'poor',
  'deny',
  'revoke',
  'draft',
  'recycle',
] as const;
export type MassStatus = (typeof MASS_STATUSES)[number];

/** 会出现在行上、但不作为 Tab 的状态 */
export type MassRowStatus = MassStatus | 'continue';

export interface MassTask {
  gtid?: string;
  name?: string;
  status?: MassRowStatus;
  /** 'list' | 'draft' | 'recycle' —— 老项目用它决定行操作,
      而状态文案又读 status,两者可能不一致(marketing-cells.tsx:39 vs :63) */
  seat?: string;
  /** 1 = 我的邮箱,2 = 系统发信通道。计划那边的 channel 是字符串,别混 */
  channel?: number;
  /** 毫秒 */
  create_time?: number;
  /** 定时发送时间,毫秒 */
  timeStart?: number;
  planCount?: number;
  sendCount?: number;
  /** 已处理数包含送达、退信、错误与跳过；不等同于已发送数。 */
  processedCount?: number;
  progress?: number;
  /** 接口的统计计数与发送配置 sendCount 是不同字段。 */
  total_count?: number;
  send_count?: number;
  bounced_count?: number;
  error_count?: number;
  notsent_count?: number;
  /** 接口的比率可能是数字字符串，读取时归一。 */
  sendPer?: number;
  deliverPer?: number;
  openedPer?: number;
  clickedPer?: number;
  downPer?: number;
}

export interface MassListQuery {
  current: number;
  pageSize: number;
  status: MassStatus;
  keyword?: string;
}

const statistic = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function normalizeMassTask(row: MassTask): MassTask {
  const planCount = statistic(row.total_count) ?? statistic(row.planCount) ?? 0;
  const delivered = statistic(row.send_count);
  const bounced = statistic(row.bounced_count) ?? 0;
  const sendCount = delivered === undefined ? (statistic(row.sendCount) ?? 0) : delivered + bounced;
  const processedCount =
    statistic(row.processedCount) ??
    sendCount + (statistic(row.error_count) ?? 0) + (statistic(row.notsent_count) ?? 0);
  const percent = (value: unknown) => Math.min(100, statistic(value) ?? 0);
  return {
    ...row,
    planCount,
    sendCount,
    processedCount,
    progress: percent(row.progress ?? (planCount > 0 ? (processedCount / planCount) * 100 : 0)),
    sendPer: percent(row.sendPer),
    deliverPer: delivered !== undefined && sendCount === 0 ? 0 : percent(row.deliverPer),
    openedPer: delivered === 0 ? 0 : percent(row.openedPer),
    clickedPer: delivered === 0 ? 0 : percent(row.clickedPer),
    downPer: delivered === 0 ? 0 : percent(row.downPer),
  };
}

export const listMassTasks = async (q: MassListQuery) => {
  const data = await postEnvelope<PageResult<MassTask> | undefined>('/marketing/tasks/show', {
    current: q.current,
    pageSize: q.pageSize,
    filter: {
      status: q.status,
      // 值为空的条件整条不发 —— 发空串后端会当成"必须匹配空"
      ...(q.keyword ? { keyword: q.keyword } : {}),
    },
  });
  return data ? { ...data, list: data.list?.map(normalizeMassTask) ?? [] } : data;
};

/**
 * Tab 角标计数。**这个接口不接受任何参数**,所以角标是全局计数、
 * 不随关键词筛选变化 —— 老项目也是这样,不是漏传。
 * 返回是 status → number 的字典,外加一个 total。
 */
export const massTaskCounts = () =>
  postEnvelope<Record<string, number> | undefined>('/marketing/tasks/show-count', {});

/** 单条操作都收 `{ gtid }` */
export type MassRemovalAction = 'recycle' | 'remove';
export type MassAction = 'start' | 'stop' | 'revoke' | MassRemovalAction;

const MASS_ACTION_PATH: Record<MassAction, string> = {
  start: '/tasks/mass/start',
  stop: '/tasks/mass/stop',
  revoke: '/tasks/mass-revoke',
  // 后端 delete 是移入回收站，drop 才是彻底删除；前端使用业务名称避免混淆。
  recycle: '/tasks/mass/delete',
  remove: '/tasks/mass/drop',
};

export const massTaskAction = (action: MassAction, gtid: string) =>
  postEnvelope<unknown>(MASS_ACTION_PATH[action], { gtid });

/** 批量是复数 `gtids`,与单条的 `gtid` 差一个字母 */
export const massTaskBulk = (action: MassRemovalAction, gtids: string[]) =>
  postEnvelope<unknown>(
    action === 'recycle' ? '/tasks/mass/multi-delete' : '/tasks/mass/multi-drop',
    { gtids },
  );

export const renameMassTask = (gtid: string, name: string) =>
  postEnvelope<unknown>('/marketing/task-rename', { gtid, name });

/** 只有这几个状态在跑,列表才需要轮询 —— 老项目是无条件 30 秒常开 */
export const massTaskLive = (rows: MassTask[]) =>
  rows.some((r) => r.status === 'running' || r.status === 'schedule' || r.status === 'continue');

/* ---------- 邮件追踪 ---------- */

export const TRACK_ACTS = ['total', 'read', 'click', 'download', 'reply'] as const;
export type TrackAct = (typeof TRACK_ACTS)[number];

export interface TrackRow {
  _id?: string;
  userid?: string;
  /** 被追踪的邮箱;收信人展示和关键词检索使用 to。 */
  email?: string;
  to?: string;
  from?: string;
  subject?: string;
  /** 已知行为见 TRACK_ACTS,保留未知行为的原始值以兼容新事件。 */
  act?: string;
  /** 事件时间/发信时间,均为毫秒。 */
  time?: number;
  sTime?: number;
  other?: string;
  device?: string;
  isp?: string;
  country?: string;
  regionName?: string;
  city?: string;
  county?: string;
  district?: string;
  ip?: string;
}

export interface TrackFilterQuery {
  act: TrackAct;
  keyword?: string;
  /** 时间预设或 YYYY-MM-DD,沿用旧接口的字段和值。 */
  time?: string;
  sTime?: string;
  /** 追踪接口使用中文国家名,多个国家取并集。 */
  country?: string[];
}

export interface TrackListQuery extends TrackFilterQuery {
  current: number;
  pageSize: number;
}

const trackFilter = (q: TrackFilterQuery) => ({
  act: q.act,
  ...(q.keyword ? { keyword: q.keyword } : {}),
  ...(q.time ? { time: q.time } : {}),
  ...(q.sTime ? { sTime: q.sTime } : {}),
  ...(q.country?.length ? { country: q.country } : {}),
});

export const listTracks = (q: TrackListQuery) =>
  postEnvelope<PageResult<TrackRow> | undefined>('/marketing/tracks/show', {
    current: q.current,
    pageSize: q.pageSize,
    sort: { time: -1 },
    filter: trackFilter(q),
  });

/**
 * 批量操作的选择口径:后端**以 selectOption 为准**,不是以 selectKeys 为准。
 * 老项目里 selectKeys 恒被覆写成"当前页的 id",所以选了 5000 条时
 * selectTotal=5000 而 selectKeys 只有 10 个 —— 拿 selectKeys 当全集会漏。
 */
export interface BulkScope {
  selectOption: 'current' | 'front' | 'all';
  selectKeys: string[];
  selectTotal: number;
}

/** 加入/取消黑名单。cancel 在提交前要翻成 delete —— 后端不认 cancel */
export const trackBulkBlack = (
  scope: BulkScope,
  query: TrackFilterQuery,
  body: { blackAction: 'add' | 'delete'; blackTypes: ('search' | 'send')[]; blackComment: string },
) =>
  postEnvelope<{ backendId: string }>('/marketing/tracks/logs-black', {
    ...scope,
    filter: trackFilter(query),
    // 黑名单读取 selectSort,标签读取 sort;都与列表的事件时间倒序一致。
    selectSort: { time: -1 },
    sort: { time: -1 },
    ...body,
  });

export const trackBulkTags = (
  scope: BulkScope,
  query: TrackFilterQuery,
  body: { action: TagAction; tags: string[] },
) =>
  postEnvelope<{ id: string }>('/marketing/tracks/logs-tags', {
    ...scope,
    filter: trackFilter(query),
    sort: { time: -1 },
    ...body,
  });

/* ---------- 智能跟进计划 ---------- */

/** 计划的 channel 是**字符串**,与群发任务的数字 channel 不是一回事 */
export type SeqChannel = 'system' | 'self';

export interface Sequence {
  /** 行主键是 _id,但写操作的请求体字段叫 id */
  _id?: string;
  name?: string;
  status?: string;
  channel?: SeqChannel;
  /** 是否在可发送时段内(列表由后端给,详情页老项目是前端算的) */
  inTime?: boolean;
  /** 毫秒 */
  create_time?: number;
  /** 发信数。拼的是 sended,不是 sent/send */
  sended?: number;
  delivered?: number;
  bounced?: number;
  opened?: number;
  clicked?: number;
  /** 回复数是单数 reply */
  reply?: number;
  /** 联系人四个状态的计数,后端**不给总数**,要前端求和 */
  active?: number;
  paused?: number;
  finished?: number;
  not_sent?: number;
  /* 下面三块只有详情接口回,列表不回 */
  schedule_id?: string;
  /** 详情带回当前计划保存的时段，优先于独立时段列表的缓存。 */
  schedule?: {
    name?: string;
    time_zone?: string;
    time_windows?: TimeWindows;
    skip_holidays?: boolean;
  };
  rules?: SeqRules;
  others?: SeqOthers;
}

export interface SeqListQuery {
  current: number;
  pageSize: number;
  keyword?: string;
  /** 筛选是复数数组 channels,而行上的字段是单数 channel */
  channels?: SeqChannel[];
}

export const listSequences = (q: SeqListQuery) =>
  postEnvelope<PageResult<Sequence> | undefined>('/sequences/sequence-list', {
    current: q.current,
    pageSize: q.pageSize,
    filter: {
      status: 'total',
      ...(q.keyword ? { keyword: q.keyword } : {}),
      ...(q.channels?.length ? { channels: q.channels } : {}),
    },
    sort: { create_time: -1 },
  });

/** 启停传的是布尔 `active`,不是状态字符串 */
export const setSequenceActive = (id: string, active: boolean) =>
  postEnvelope<unknown>('/sequences/sequence-active', { id, active });

/**
 * 新建计划。
 *
 * ⚠️ **必须打 `/sequence-create`,不能用 `sequence-save`** ——
 * 后者是 `updateOne({uid, _id}, ...)`(`service/sequence.ts:1403`),
 * **只改不建**,传个空 id 过去什么也不会发生、还回 success。
 *
 * 失败有三种,都以 `success:false` + 中文 message 回来,不是异常:
 * - 名称重复(同一 userid 下同名计划已存在)
 * - 「序列数量超过限制」并带 `code: 505` —— 非 VIP 撞到配额,该引导升级
 * - 「操作频繁」—— 后端有创建锁
 * 所以用 postEnvelopeFull,把 message 原样念给用户。
 */
export const createSequence = (name: string, channel: SeqChannel) =>
  postEnvelopeFull<{ id?: string } | undefined>('/sequences/sequence-create', { name, channel });

/** 非 VIP 撞到计划数量配额时后端带的码。界面据此引导升级而不是只弹一句错 */
export const SEQ_QUOTA_CODE = 505;

/**
 * 计划下拉选项。**不分页、不过滤**,一次把这个企业下的全部计划都给。
 * 给「把联系人加进计划」这类跨模块入口用。
 */
export interface SeqOption {
  id: string;
  name: string;
  status: string;
  userid: string;
}

export const listSequenceOptions = () =>
  postEnvelope<SeqOption[] | undefined>('/sequences/sequence-options', {}).then((r) => r ?? []);

export const copySequence = (id: string) =>
  postEnvelope<unknown>('/sequences/sequence-copy', { id });

export const deleteSequence = (id: string) =>
  postEnvelope<unknown>('/sequences/sequence-delete', { id });

export const renameSequence = (id: string, name: string) =>
  postEnvelope<unknown>('/sequences/sequence-save', { id, name });

/* ---------- 计划的派生指标(后端只给计数,五个率全是前端算) ---------- */

/** 联系人总数:后端没有这个字段,是四个状态计数之和 */
export const seqContactTotal = (s: Sequence) =>
  (s.active ?? 0) + (s.paused ?? 0) + (s.finished ?? 0) + (s.not_sent ?? 0);

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

/**
 * 五个率的分母**各不相同**,老项目 table-view.tsx:463-472 就是这么写的:
 * - 送达率的分母是 sended
 * - **退信率的分母是 delivered + bounced**,不是 sended
 * - 阅读/点击/回复率的分母都是 delivered
 * 统一成一个分母会算错,尤其退信率。
 */
export const seqRates = (s: Sequence) => {
  const sended = s.sended ?? 0;
  const delivered = s.delivered ?? 0;
  const bounced = s.bounced ?? 0;
  return {
    delivered: pct(delivered, sended),
    bounced: pct(bounced, delivered + bounced),
    opened: pct(s.opened ?? 0, delivered),
    clicked: pct(s.clicked ?? 0, delivered),
    reply: pct(s.reply ?? 0, delivered),
  };
};

/* ---------- 邮件群发 · 详情 ---------- */

/**
 * 详情接口返回的任务对象。字段语义有两处**与直觉相反**,是这块最大的坑:
 *
 * 1. **`send_count` 是「送达数」,不是「发送数」**。
 *    实际发送数 = send_count + bounced_count。
 *    (老项目 config.tsx:33-38「送达」的 countId 就是 send_count;
 *     performance.tsx:97 送达率 = send_count / (send_count + bounced_count))
 * 2. **`_num` 是人数(去重),`_count` 是人次**。
 *    opened_num 是阅读人数、opened_count 是阅读人次 —— 别按英文直觉反过来。
 */
export interface MassTaskDetail extends MassTask {
  total_count?: number;
  /** 送达数(见上) */
  send_count?: number;
  bounced_count?: number;
  opened_num?: number;
  opened_count?: number;
  clicked_num?: number;
  clicked_count?: number;
  down_num?: number;
  down_count?: number;
  notsent_count?: number;
  error_count?: number;
}

/** 详情响应就是任务对象本身,没有 data.data 二层嵌套 */
export const getMassTaskDetail = (gtid: string) =>
  postEnvelope<MassTaskDetail | undefined>('/marketing/task-details', { gtid });

/**
 * 收件人明细的状态。`countId` 是详情对象里对应的计数字段名 ——
 * 注意「发送」对 total_count、「送达」对 send_count,不要按字面直觉映射。
 */
export const RECIPIENT_STATUS_KEYS = [
  'total',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'notsent',
  'error',
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUS_KEYS)[number];

/** 各状态对应详情对象里的计数字段 */
export const RECIPIENT_STATUSES = [
  { key: 'total', countId: 'total_count' },
  { key: 'delivered', countId: 'send_count' },
  { key: 'opened', countId: 'opened_num' },
  { key: 'clicked', countId: 'clicked_num' },
  { key: 'bounced', countId: 'bounced_count' },
  { key: 'notsent', countId: 'notsent_count' },
  { key: 'error', countId: 'error_count' },
] as const satisfies readonly { key: RecipientStatus; countId: keyof MassTaskDetail }[];

/** 行级状态,与上面的筛选枚举**不是一套**,只有 bounced / notsent 重名 */
export type MailStatus = 'success' | 'fail' | 'notsent' | 'bounced';

export interface RecipientRow {
  _id?: string;
  gtid?: string;
  sid?: string;
  /** 群发发送日志的收信地址，联系人被删除后仍保留。 */
  to?: string;
  contact?: ContactRow | null;
  channel?: number;
  subject?: string;
  read_num?: number;
  click_num?: number;
  /** 发送提示/错误信息，亦用于未发送原因筛选。 */
  error?: string;
  /** 兼容旧响应；当前日志优先读取 to、contact、error。 */
  email?: string;
  orgName?: string;
  name?: string;
  status?: MailStatus;
  /** 不发送的原因,后端返回的是**中文串本身** */
  reason?: string;
  htmlId?: string;
  html?: string;
  /** 毫秒 */
  create_time?: number;
  read_time?: number;
  click_time?: number;
}

export interface RecipientQuery {
  gtid: string;
  current: number;
  pageSize: number;
  status: RecipientStatus;
  keyword?: string;
  /** 只有 status='notsent' 且选了具体原因时才发 —— 老项目其余分支显式丢掉它 */
  reason?: string;
}

export const listRecipients = (q: RecipientQuery) =>
  postEnvelope<PageResult<RecipientRow> | undefined>('/marketing/task-logs', {
    current: q.current,
    pageSize: q.pageSize,
    ...(q.keyword ? { keyword: q.keyword } : {}),
    sort: { create_time: -1 },
    filter: {
      gtid: q.gtid,
      status: q.status,
      ...(q.status === 'notsent' && q.reason ? { reason: q.reason } : {}),
    },
  });

/** 邮件正文。参数名叫 id,值却来自行上的 htmlId */
export const getMailHtml = (htmlId: string) =>
  postEnvelope<{ html?: string } | undefined>('/marketing/task-html', { id: htmlId });

/**
 * 「数据统计」五个指标 —— **不发请求,全部由详情对象前端算**。
 * 口径照老项目 performance.tsx:89-118:
 *   发送率 = (送达 + 退信) / 提交
 *   送达率 =  送达 / (送达 + 退信)
 *   阅读率 =  阅读人数 / 送达
 *   点击率 =  点击人数 / 送达
 *   下载率 =  下载人数 / 送达
 *
 * 注意后三项的分母是**送达数**(send_count),不是实际发送数。
 * 老项目用 numeral 格式化,send_count=0 而 opened_num>0 时会直接
 * 把字符串 "NaN" 渲染到界面上 —— 这里分母为 0 一律给 0。
 */
export function massPerf(t: MassTaskDetail) {
  const submitted = t.total_count ?? 0;
  const delivered = t.send_count ?? 0;
  const bounced = t.bounced_count ?? 0;
  const sent = delivered + bounced;
  return {
    sent: { rate: pct(sent, submitted), a: submitted, b: sent },
    delivered: { rate: pct(delivered, sent), a: sent, b: delivered },
    opened: {
      rate: pct(t.opened_num ?? 0, delivered),
      a: t.opened_num ?? 0,
      b: t.opened_count ?? 0,
    },
    clicked: {
      rate: pct(t.clicked_num ?? 0, delivered),
      a: t.clicked_num ?? 0,
      b: t.clicked_count ?? 0,
    },
    down: { rate: pct(t.down_num ?? 0, delivered), a: t.down_num ?? 0, b: t.down_count ?? 0 },
  };
}

/* ---------- 智能跟进计划 · 详情 ---------- */

/**
 * 同一个计划 ID,三个接口三个参数名 —— 老项目就是这样,别顺手统一:
 *   sequence-details  收 { id }
 *   sequence-summary  收 { id }
 *   step-list         收 { seqId }
 */
export const getSequence = (id: string) =>
  postEnvelope<Sequence | undefined>('/sequences/sequence-details', { id });

export interface SeqSummary {
  stepsCount?: number;
  sended?: number;
  delivered?: number;
  bounced?: number;
  opened?: number;
  clicked?: number;
  reply?: number;
}
export const getSequenceSummary = (id: string) =>
  postEnvelope<SeqSummary | undefined>('/sequences/sequence-summary', { id });

/** 步骤下挂的模板版本 */
export interface StepTemplate {
  /** 步骤与模板的关联 ID，启停/移除用它；编辑模板必须使用 tempId。 */
  _id?: string;
  tempId?: string;
  subject?: string;
  details?: { _id?: string; foid?: string; auth?: string };
  /** 为空表示模板已被删除 —— 老项目在界面上显示「该邮件模板已被删除」 */
  name?: string;
  active?: boolean;
  delivered?: number;
  bounced?: number;
  opened?: number;
  clicked?: number;
  reply?: number;
}

export interface SeqStep {
  _id?: string;
  /** 步骤上带回了所属计划 ID,移动/删除都要同时传 seqId 和 id */
  seqId?: string;
  /** 1 起的序号 */
  step?: number;
  type?: string;
  templates?: StepTemplate[];
  /** 模板 id 数组。列表接口未必回这个(一定回 templates),编辑回填要两边都兜 */
  template_ids?: string[];
  /** 发信账号 id */
  senders?: string[];
  /**
   * 间隔用 wait_mode + wait_time 两个字段表达,不是毫秒也不是 ISO。
   * 老项目界面上还有个 wait_type('0' 立即 / '1' 延迟),那是**纯前端的**,
   * 提交前会折叠掉:立即 == wait_mode 'minute' + wait_time 0。接口里没有 wait_type。
   */
  wait_mode?: 'minute' | 'hour' | 'day';
  wait_time?: number;
  /** 该步骤上的联系人分布,后端直接给,前端不算 */
  active?: number;
  paused?: number;
  finished?: number;
  not_sent?: number;
}

/** **响应的 data 就是数组本身**,没有 list、没有分页 */
export const listSteps = (seqId: string) =>
  postEnvelope<SeqStep[] | undefined>('/sequences/step-list', { seqId }).then((rows) =>
    [...(rows ?? [])].sort((a, b) => (a.step ?? 0) - (b.step ?? 0)),
  );

/** 单步上移/下移,立刻生效。两个 ID 都要传 */
export const moveStep = (dir: 'up' | 'down', seqId: string, id: string) =>
  postEnvelope<unknown>(dir === 'up' ? '/sequences/step-move-up' : '/sequences/step-move-down', {
    seqId,
    id,
  });

/** 「立即」在界面上是一种间隔,但落到接口就是 wait_time = 0 */
export const stepWaitIsImmediate = (s: SeqStep) => !s.wait_time;

/* ---------- 步骤的新建 / 编辑 / 删除 ---------- */

/**
 * 步骤草稿。老项目还有 max_emails_per_day / domain_emails_per_day 两个字段,
 * 但**弹窗里从头到尾没有对应控件**(step-edit-from.tsx 只渲染「何时开始」那一段),
 * 于是两条相关校验永远触发不到、两个 null 白白进请求体。发送上限真正的入口在
 * 计划级的「高级规则」,这里不再带。
 */
export interface StepDraft {
  /** 编辑时才有。请求体字段叫 id,而行上的主键是 _id */
  id?: string;
  /** 1 起。新建时由前端算(列表长度 + 1),编辑时沿用原值 */
  step: number;
  template_ids: string[];
  senders: string[];
  wait_mode: 'minute' | 'hour' | 'day';
  wait_time: number;
}

export const STEP_TEMPLATE_MAX = 10;
export const SEQUENCE_STEP_MAX = 16;

export const setStepTemplateActive = (stepId: string, id: string, active: boolean) =>
  postEnvelope<unknown>('/sequences/template-active', { stepId, id, active });
export const deleteStepTemplate = (stepId: string, id: string) =>
  postEnvelope<unknown>('/sequences/template-delete', { stepId, id });
export const reorderSteps = (
  seqId: string,
  orders: { id: string; step: number }[],
  moveStep: number,
  newStep: number,
) => postEnvelope<unknown>('/sequences/step-move', { seqId, orders, moveStep, newStep });

/** 各单位下 wait_time 的上限,换算过去都是 90 天 */
export const WAIT_MAX: Record<StepDraft['wait_mode'], number> = {
  minute: 90 * 24 * 60,
  hour: 90 * 24,
  day: 90,
};

/**
 * 换单位时把数值夹进新单位的上限。
 * 老项目是超限就重置成 3(129600 分钟切到小时直接变 3,不是 2160),
 * 用户填的数字凭空消失;夹到边界至少保住「尽可能久」这个意图。
 */
export const clampWait = (mode: StepDraft['wait_mode'], time: number) =>
  Math.min(Math.max(1, Math.round(time) || 1), WAIT_MAX[mode]);

/**
 * 「立即」在界面上是一种间隔,落到接口是 wait_time = 0 + wait_mode 'minute'。
 * 只有第 1 步能选立即 —— 第 2 步之后「立即」等于和上一步同时发,没有意义。
 */
export const stepImmediate = { wait_mode: 'minute' as const, wait_time: 0 };

/** template_ids 是启用的源模板 ID；templates._id 是关联 ID，不能混用。 */
export function draftFromStep(s: SeqStep): StepDraft {
  const ids = Array.isArray(s.template_ids)
    ? s.template_ids
    : (s.templates ?? [])
        .filter((t) => t.active !== false)
        .map((t) => t.tempId ?? t.details?._id ?? '')
        .filter(Boolean);
  return {
    id: s._id,
    step: s.step ?? 1,
    template_ids: ids,
    senders: s.senders ?? [],
    wait_mode: s.wait_mode ?? 'day',
    wait_time: s.wait_time ?? 0,
  };
}

/** 新建时的默认草稿:第 1 步默认「立即」,之后默认隔 3 天 */
export const newStepDraft = (step: number): StepDraft =>
  step === 1
    ? { step, template_ids: [], senders: [], ...stepImmediate }
    : { step, template_ids: [], senders: [], wait_mode: 'day', wait_time: 3 };

const stepBody = (seqId: string, d: StepDraft) => ({
  seqId,
  type: 'auto_email',
  template_ids: d.template_ids,
  senders: d.senders,
  step: d.step,
  wait_mode: d.wait_mode,
  wait_time: d.wait_time,
});

export const createStep = (seqId: string, d: StepDraft) =>
  postEnvelope<unknown>('/sequences/step-create', stepBody(seqId, d));

/** 保存比新建多一个 id */
export const saveStep = (seqId: string, d: StepDraft) =>
  postEnvelope<unknown>('/sequences/step-save', { ...stepBody(seqId, d), id: d.id });

/**
 * 删除。seqId 一律取自路由,不用行上的 —— 老项目删除/上移/下移读的是行内 seqId、
 * 保存读的是 store 的,两套来源,行内那个字段是否真的回得来还没定论。
 */
export const deleteStep = (seqId: string, id: string) =>
  postEnvelope<unknown>('/sequences/step-delete', { seqId, id });

/* ---------- 计划的高级规则 ---------- */

/** 同公司有人回复后，其他联系人怎么处理。Replay 拼写遵循接口约定。 */
export const REPLAY_ACTIONS = ['nothing', 'notSent', 'delayDays'] as const;
export type ReplayAction = (typeof REPLAY_ACTIONS)[number];

export interface SeqRules {
  /** 客户回信后结束跟进 */
  finishReply?: boolean;
  /** 不发给无效邮箱 */
  notSentInvalid?: boolean;
  /** 不发给黑名单 */
  notSentBlack?: boolean;
  /** 不发给这些标签下的联系人。元素是标签的 id(小写,不是 _id) */
  notSentTags?: string[];
  /** AI 智能拦截,只有系统通道有 */
  aiGuard?: boolean;
  max_emails_selected?: boolean;
  /** 本计划每 24 小时的发送上限 */
  max_emails_per_day?: number | null;
  domain_emails_selected?: boolean;
  /** 单个域名每 24 小时的发送上限 */
  domain_emails_per_day?: number | null;
  otherReplayValue?: ReplayAction;
  otherReplayDelayDays?: number | null;
}

export interface SeqOthers {
  trackSelected?: boolean;
  fromNameSelected?: boolean;
  fromNameValue?: string | null;
  replyToSelected?: boolean;
  replyToValue?: string | null;
}

export const FROM_NAME_LIMIT = 32;
export const MAX_EMAILS_LIMIT = 1_000_000;
export const DOMAIN_EMAILS_LIMIT = 10_000;
export const REPLAY_DELAY_LIMIT = 100;
export const DEFAULT_MAX_EMAILS = 10_000;
export const DEFAULT_DOMAIN_EMAILS = 10;
export const DEFAULT_REPLAY_DELAY_DAYS = 30;

export const DEFAULT_RULES: SeqRules = {
  finishReply: true,
  notSentInvalid: true,
  notSentBlack: true,
  notSentTags: [],
  aiGuard: true,
  max_emails_selected: false,
  max_emails_per_day: null,
  domain_emails_selected: false,
  domain_emails_per_day: null,
  otherReplayValue: 'nothing',
  otherReplayDelayDays: null,
};

export const DEFAULT_OTHERS: SeqOthers = {
  trackSelected: true,
  fromNameSelected: false,
  fromNameValue: '',
  replyToSelected: false,
  replyToValue: '',
};

/**
 * 邮箱格式。老项目在设置页用的是本地正则(不打接口),这里照搬同一套规则:
 * 有且只有一个 @、本地部分 ≤64、域名 ≤128 且每段 ≤63。
 */
export function emailOk(raw: string): boolean {
  const v = raw.trim();
  const at = v.split('@');
  if (at.length !== 2) return false;
  const [local, domain] = at;
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 128) return false;
  if (domain.split('.').some((seg) => seg.length > 63)) return false;
  return /^([a-z0-9]+(?:[._-][a-z0-9]+)*)@([a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,})$/i.test(v);
}

/** 高级规则整表保存。rules / others 嵌套提交,不摊平 */
export const saveSequenceSettings = (body: {
  id: string;
  schedule_id: string;
  rules: SeqRules;
  others: SeqOthers;
}) => postEnvelope<unknown>('/sequences/sequence-save', { ...body });

/* ---------- 计划详情 · 联系人 / 邮件 / 活动 ---------- */

/** 注意 not_sent 是下划线,与群发那边的 notsent 不是一个写法 */
export const SEQ_CONTACT_STATUSES = ['active', 'paused', 'finished', 'not_sent'] as const;
export type SeqContactStatus = (typeof SEQ_CONTACT_STATUSES)[number];

/** 计划成员用 cid 标识；客户资料来自关联的 contact，不能读成顶层字段。 */
export interface SeqContact {
  _id?: string;
  cid?: string;
  userid?: string;
  contact?: Partial<ContactRow> & { name?: string };
  status?: SeqContactStatus;
  reason?: string;
  step?: number;
  create_time?: number;
  prev_time?: number;
}

export const SEQ_CONTACT_VERIFY = ['valid', 'unkown', 'invalid', 'waiting', ''] as const;
export type SeqContactVerify = (typeof SEQ_CONTACT_VERIFY)[number];
export const SEQ_CONTACT_SORTS = ['create_time', 'step', 'status', 'userid'] as const;
export type SeqContactSort = (typeof SEQ_CONTACT_SORTS)[number];
export interface SeqContactFilter {
  keyword?: string;
  step?: number[];
  status?: SeqContactStatus[];
  verify_status?: SeqContactVerify[];
  tags?: string[];
}
export interface SeqSubQuery {
  seqId: string;
  current: number;
  pageSize: number;
  keyword?: string;
}
export interface SeqContactQuery extends Omit<SeqContactFilter, 'status'> {
  // 保留旧调用兼容；实际发送给后端的 status 一律为数组。
  status?: SeqContactStatus[] | SeqContactStatus | '';
  order?: 'asc' | 'desc';
  sortBy?: SeqContactSort;
}
export const seqContactFilter = (q: SeqContactQuery): SeqContactFilter => {
  const status = typeof q.status === 'string' ? (q.status ? [q.status] : []) : q.status;
  return {
    ...(q.keyword ? { keyword: q.keyword } : {}),
    ...(q.step?.length ? { step: q.step } : {}),
    ...(status?.length ? { status } : {}),
    ...(q.verify_status?.length ? { verify_status: q.verify_status } : {}),
    ...(q.tags?.length ? { tags: q.tags } : {}),
  };
};
export const listSeqContacts = (q: SeqSubQuery & SeqContactQuery) =>
  postEnvelope<PageResult<SeqContact> | undefined>('/sequences/contact-list', {
    seqId: q.seqId,
    current: q.current,
    pageSize: q.pageSize,
    filter: seqContactFilter(q),
    sort: { [q.sortBy ?? 'create_time']: q.order === 'asc' ? 1 : -1 },
  });

/* ---------- 往计划里加人 / 改计划里联系人的状态与标签 ---------- */

/**
 * 把联系人加进计划。
 *
 * **按视图或标签整批加,不是逐个选人** —— 后端拿 `views` / `tags` 现算出一个
 * 客户查询,再把命中的联系人一次性灌进去(`contactSingleAddByQuery`)。
 * 两个数组都是必填,可以有一个为空,但不能都不传(DTO 是 required)。
 *
 * ⚠️ **返回的 `total` 恒为 0,别显示它。** 后端是
 * `while (cids.length) { cids.splice(0, 1000) ... }` 然后
 * `return { total: cids.length, add }` —— splice 把数组抽干了才 return。
 * 只有 `add`(真正新加进去的条数)是准的。
 */
export interface SeqAddResult {
  /** 真正新加进去的条数。已经在计划里的不会重复计入 */
  add: number;
}

export const addSeqContacts = async (
  seqId: string,
  by: { views?: string[]; tags?: string[] },
): Promise<SeqAddResult> => {
  const r = await postEnvelope<{ add?: number } | undefined>('/sequences/contact-add', {
    seqId,
    views: by.views ?? [],
    tags: by.tags ?? [],
  });
  return { add: Number(r?.add) || 0 };
};

/**
 * 计划里联系人的批量动作。
 *
 * `delete` 是**移出这个计划**,不是删联系人本身 —— 客户还在客户管理里。
 * `finished` 结束跟进、`paused` 暂停、`active` 恢复。
 *
 * ⚠️ **`selectTotal` 为 0 时后端直接 `return {success:true}` 什么都不做**
 * (`controller/sequence.ts:466`)。所以它不是「一共多少条」的展示值,
 * 而是**这次要作用到几条**,必须真实填。
 */
export const SEQ_CONTACT_ACTIONS = ['delete', 'finished', 'paused', 'active'] as const;
export type SeqContactAction = (typeof SEQ_CONTACT_ACTIONS)[number];

/** 批量范围。与客户管理那套 selectOption 同源 */
export interface SeqScope extends SeqContactQuery {
  seqId: string;
  selectKeys: string[];
  selectOption: 'current' | 'front' | 'all';
  selectTotal: number;
}

const seqScopeBody = (s: SeqScope) => ({
  seqId: s.seqId,
  selectKeys: s.selectKeys,
  selectOption: s.selectOption,
  selectTotal: s.selectTotal,
  filter: seqContactFilter(s),
  sort: { [s.sortBy ?? 'create_time']: s.order === 'asc' ? 1 : -1 },
});

export const changeSeqContactStatus = (s: SeqScope, status: SeqContactAction) =>
  postEnvelopeFull<unknown>('/sequences/contacts-status-change', {
    ...seqScopeBody(s),
    status,
  });

/**
 * 给计划里的联系人 / 邮件打标签。
 *
 * ⚠️ 取值是 `add` / `replace` / `del`(DTO 的 enum)—— **不是 push/pull**,
 * 那是插件云端那一族的写法。收成联合类型,不让调用方自由传字符串。
 */
export const SEQ_TAG_ACTIONS = ['add', 'replace', 'del'] as const;
export type SeqTagAction = (typeof SEQ_TAG_ACTIONS)[number];

export const tagSeqContacts = (s: SeqScope, action: SeqTagAction, tags: string[]) =>
  postEnvelopeFull<unknown>('/sequences/contacts-tags', { ...seqScopeBody(s), action, tags });

export const SEQ_EMAIL_STATUSES = ['success', 'bounced', 'fail'] as const;
export type SeqEmailStatus = (typeof SEQ_EMAIL_STATUSES)[number];
export const SEQ_EMAIL_TRACKS = ['opened', 'clicked', 'replied', 'unopened'] as const;
export type SeqEmailTrack = (typeof SEQ_EMAIL_TRACKS)[number];

/** 发送记录来自邮件历史，客户资料在 contact 中，步骤通过 stepId 关联。 */
export interface SeqEmail {
  _id?: string;
  gtid?: string;
  sid?: string;
  to?: string;
  contact?: {
    cid?: string | null;
    name?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    orgName?: string;
    tags?: string[];
  };
  subject?: string;
  status?: MailStatus | (string & {});
  stepId?: string;
  htmlId?: string;
  channel?: number | string;
  error?: string;
  noTrack?: boolean;
  read_num?: number;
  click_num?: number;
  reply_num?: number;
  read_time?: number | string;
  click_time?: number | string;
  createAt?: number | string;
  create_time?: number;
}

export interface SeqEmailFilter {
  keyword?: string;
  stepIds?: string[];
  status?: SeqEmailStatus[];
  trackStatus?: SeqEmailTrack[];
}
export interface SeqEmailQuery extends SeqSubQuery, SeqEmailFilter {
  order?: 'asc' | 'desc';
}
export interface SeqEmailScope extends SeqEmailFilter {
  seqId: string;
  selectKeys: string[];
  selectOption: 'current' | 'front' | 'all';
  selectTotal: number;
  order?: 'asc' | 'desc';
}
const seqEmailFilter = (q: SeqEmailFilter) => ({
  ...(q.keyword?.trim() ? { keyword: q.keyword.trim() } : {}),
  ...(q.stepIds?.length ? { stepIds: q.stepIds } : {}),
  ...(q.status?.length ? { status: q.status } : {}),
  ...(q.trackStatus?.length ? { trackStatus: q.trackStatus } : {}),
});
export const listSeqEmails = (q: SeqEmailQuery) =>
  postEnvelope<PageResult<SeqEmail> | undefined>('/sequences/email-list', {
    seqId: q.seqId,
    current: q.current,
    pageSize: q.pageSize,
    filter: seqEmailFilter(q),
    sort: { create_time: q.order === 'asc' ? 1 : -1 },
  });

/** 批量操作重用列表的筛选、排序，选中的是发送记录 _id，而非联系人 ID。 */
export const tagSeqEmails = (s: SeqEmailScope, action: SeqTagAction, tags: string[]) =>
  postEnvelopeFull<{ backendId?: string }>('/sequences/email-tags', {
    seqId: s.seqId,
    selectKeys: s.selectKeys,
    selectOption: s.selectOption,
    selectTotal: s.selectTotal,
    filter: seqEmailFilter(s),
    sort: { create_time: s.order === 'asc' ? 1 : -1 },
    action,
    tags,
  });

export const ACTIVITY_TYPES = ['sequence', 'step', 'template', 'contact', 'setting'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface SeqActivity {
  _id?: string;
  type?: ActivityType | (string & {});
  userid?: string;
  action?: string;
  count?: number;
  count_2?: number;
  message?: string;
  /** 旧标签日志直接存 ID 数组，新版使用 tags/views 对象。 */
  data?: { tags?: string[]; views?: string[] } | string[];
  /** 兼容早期前端模拟数据。真实接口返回 action/message 和 userid。 */
  content?: string;
  operator?: string;
  /** 数据库 Date 序列化为 ISO 字符串，也兼容毫秒。 */
  createAt?: string | number;
}

export const listSeqActivity = (
  q: SeqSubQuery & { type?: ActivityType[] | ActivityType | ''; order?: 'asc' | 'desc' },
) =>
  postEnvelope<PageResult<SeqActivity> | undefined>('/sequences/activity-list', {
    seqId: q.seqId,
    current: q.current,
    pageSize: q.pageSize,
    filter: {
      ...(q.type?.length ? { type: Array.isArray(q.type) ? q.type : [q.type] } : {}),
    },
    sort: { createAt: q.order === 'asc' ? 1 : -1 },
  });

/** 报告。**日期是 'YYYY-MM-DD' 字符串**,不是时间戳 —— 与本模块其它时间字段相反 */
export interface ReportPoint {
  date?: string;
  sended?: number;
  opened?: number;
  reply?: number;
}
export type SeqReportMetric = 'sended' | 'opened' | 'reply';
/** total/list 按查询日期统计；percent 固定比较 [D-7,D-1] 与 [D-14,D-8]，无基数为 null。 */
export interface SeqReport {
  list: ReportPoint[];
  sended: { total: number; percent: number | null };
  opened: { total: number; percent: number | null };
  reply: { total: number; percent: number | null };
}
export const getSeqReport = (seqId: string, beginDate: string, endDate: string) =>
  postEnvelope<SeqReport | undefined>('/sequences/report-data', {
    seqId,
    beginDate,
    endDate,
  });

/** 'YYYY-MM-DD',按本地时区取 —— toISOString 会按 UTC 切,跨时区会差一天 */
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------- 群发创建向导 ---------- */

/**
 * 向导的完整草稿。老项目把它平铺在一个 useSetState 里,四步共写同一个对象,
 * 提交时**原样**发给 /tasks/mass/add(不做裁剪),所以纯前端字段也会一起过去。
 *
 * 三个必须记住的点:
 * - `match` / `exclude` 是**混合数组**:标签 id 与视图 id 装在同一个 string[] 里,
 *   靠去两份清单里查才知道某个 id 是标签还是视图
 * - `mode` 决定第一步长什么样:'view' 让用户挑标签/视图;
 *   'filter' 是从客户列表带着筛选条件进来的,收件人已定,不给挑
 * - `channel` 是数字(1 我的邮箱 / 2 优质通道),与跟进计划的字符串 channel 不是一回事
 */
export interface MassDraft {
  [k: string]: unknown;
  name: string;
  mode: 'view' | 'filter';
  /** 收件人:标签 id 与视图 id 混装 */
  match: string[];
  /** 排除对象:同上 */
  exclude: string[];
  /** 邮件模板 id,多选 —— 每封随机取一个 */
  contentsIds: string[];
  attIds: string[];
  /** mode='filter' 时由客户列表带进来的那套批量口径 */
  filters: unknown[];
  logic: 'and' | 'or';
  keyword: string;
  selectOption: 'current' | 'front' | 'all';
  selectSort: Record<string, 1 | -1>;
  selectKeys: string[];
  /** 后端算出来的命中人数。**前端只读**,由 mass-count 回填 */
  selectTotal: number;
  /** 跳过前 N 个 */
  skipNum: number;
  /** 最多发 N 封。**0 表示不限**,不是"一封都不发" */
  limitNum: number;
  channel: 1 | 2;
  /** 发信账号 id:channel=1 存 maid,channel=2 存 sender 的 _id */
  senders: string[];
  track: boolean;
  /** 发信间隔秒数,只在 channel=1 下有意义 */
  timeSleep: number;
  fromName: string;
  replyTo: string;
  proxy: boolean;
  attNormal: boolean;
  sendAtOnce: boolean;
  /** 定时发送时刻,毫秒。sendAtOnce=false 时才有意义 */
  timeStart: number;
  /** AI 智能拦截,只在 channel=2 下有意义 */
  aiGuard: boolean;
}

export const MASS_DRAFT_DEFAULTS: MassDraft = {
  name: '',
  mode: 'view',
  match: [],
  exclude: [],
  contentsIds: [],
  attIds: [],
  filters: [],
  logic: 'and',
  keyword: '',
  selectOption: 'current',
  selectSort: {},
  selectKeys: [],
  selectTotal: 0,
  skipNum: 0,
  limitNum: 0,
  channel: 2,
  senders: [],
  track: true,
  timeSleep: 60,
  fromName: '',
  replyTo: '',
  proxy: false,
  attNormal: false,
  sendAtOnce: true,
  timeStart: 0,
  aiGuard: true,
};

/**
 * 实际会发出去多少封。老项目这段逻辑在抽屉头部,四个分支缺一不可:
 * limitNum=0 是"不限"而不是"零",skipNum 超过总数时是 0 而不是负数。
 */
export function realSendCount(selectTotal: number, skipNum: number, limitNum: number) {
  if (limitNum === 0) return Math.max(0, selectTotal - skipNum);
  if (skipNum >= selectTotal) return 0;
  if (limitNum + skipNum <= selectTotal) return limitNum;
  return selectTotal - skipNum;
}

/** 收件人数 + 预览用的客户样本。请求体就是草稿里那一坨勾选口径字段 */
export interface MassCountResult {
  count?: number;
  /** 元素可能是 cid 字符串,也可能是 { cid } 对象 —— 老项目两种都兜了 */
  customers?: (string | { cid?: string })[];
}
export const massCount = (d: MassDraft) =>
  postEnvelope<MassCountResult | undefined>('/tasks/mass-count', {
    logic: d.logic,
    match: d.match,
    exclude: d.exclude,
    mode: d.mode,
    filters: d.filters,
    keyword: d.keyword,
    selectOption: d.selectOption,
    selectSort: d.selectSort,
    selectKeys: d.selectKeys,
    selectTotal: d.selectTotal,
  });

/** customers 里混着字符串和对象,取 cid 要兜两种 */
export const customerCid = (c: string | { cid?: string } | undefined) =>
  typeof c === 'string' ? c : (c?.cid ?? '');

/**
 * 「再次发送」要用的原任务输入。**不是 /marketing/task-details**(那个给详情页看统计),
 * 是另一个接口,回的是整份任务文档(七十来个键、命名 snake_case 与驼峰混着)。
 */
export const getMassTaskInput = (gtid: string) =>
  postEnvelope<Record<string, unknown> | undefined>('/tasks/mass-info', { gtid });

/**
 * 把原任务折回一份草稿。只取输入字段 —— 老项目是把整份文档摊进向导状态,
 * 于是 gtid 和 send_count / progress / userid 这些只读字段会跟着新任务一起提交回去。
 * 名字也重新生成:照抄原名的话列表里会出现两条一模一样的任务,分不清哪条是新的。
 */
export function draftFromTask(task: Record<string, unknown>): Partial<MassDraft> {
  const pickArr = (k: string) => (Array.isArray(task[k]) ? (task[k] as string[]) : undefined);
  const num = (k: string, d: number) => (typeof task[k] === 'number' ? (task[k] as number) : d);
  const bool = (k: string, d: boolean) => (typeof task[k] === 'boolean' ? (task[k] as boolean) : d);
  const str = (k: string) => (typeof task[k] === 'string' ? (task[k] as string) : undefined);
  return {
    mode: task.mode === 'filter' ? 'filter' : 'view',
    match: pickArr('match') ?? [],
    exclude: pickArr('exclude') ?? [],
    contentsIds: pickArr('contentsIds') ?? [],
    attIds: pickArr('attIds') ?? [],
    filters: Array.isArray(task.filters) ? (task.filters as unknown[]) : [],
    logic: task.logic === 'or' ? 'or' : 'and',
    // 详情里的 keyword 是**数组**,而向导收的是字符串 —— 同名不同型
    keyword: Array.isArray(task.keyword)
      ? (task.keyword as string[]).join(',')
      : (str('keyword') ?? ''),
    selectOption:
      task.selectOption === 'all' || task.selectOption === 'front'
        ? (task.selectOption as 'all' | 'front')
        : 'current',
    selectSort: (task.selectSort as Record<string, 1 | -1>) ?? {},
    selectKeys: pickArr('selectKeys') ?? [],
    /**
     * selectTotal 是**输入**不是统计:filter 模式下后端就靠它按 selectOption
     * 取「前 N 条」。漏掉它的话 filter 模式的任务再次发送后恒命中 0 人,
     * 而那一步又不给挑收件人 —— 用户没有任何办法把 0 改回去。
     */
    selectTotal: num('selectTotal', 0),
    skipNum: num('skipNum', 0),
    limitNum: num('limitNum', 0),
    channel: task.channel === 1 ? 1 : 2,
    senders: pickArr('senders') ?? [],
    track: bool('track', true),
    timeSleep: num('timeSleep', 60),
    fromName: str('fromName') ?? '',
    replyTo: str('replyTo') ?? '',
    proxy: bool('proxy', false),
    attNormal: bool('attNormal', false),
    aiGuard: bool('aiGuard', true),
    // 定时不跟着复制:原任务的发送时刻多半已经过去了
    sendAtOnce: true,
    timeStart: 0,
  };
}

/* ---------- 邮件模板 ---------- */

/*
 * 发信账号(自有邮箱 / 通道账号)与发送时段的契约都在 `@/api/sending`,
 * 那三样东西在「设置」里有自己的管理页,不属于营销模块。
 */

/**
 * 邮件模板。返回的是**文件夹与模板混在一起**的平表,
 * `folder: true` 的行是文件夹、不能选 —— 老项目提交前专门过滤过一次。
 */
export interface MailTemplate {
  _id?: string;
  auth?: string;
  name?: string;
  subject?: string;
  folder?: boolean;
  /** 归属人,用来分「我的 / 团队的」 */
  userid?: string;
}
export async function listMailTemplates(): Promise<PageResult<MailTemplate> | undefined> {
  const pageSize = 100;
  const list: MailTemplate[] = [];
  for (let current = 1; ; current++) {
    const page = await postEnvelope<PageResult<MailTemplate> | undefined>(
      '/mailbox/templates-list',
      {
        filter: {},
        current,
        pageSize,
        sort: { _id: 1 },
        owner: 'everyone',
      },
    );
    if (!page) {
      if (current === 1) return undefined;
      throw new Error('邮件模板分页响应缺失');
    }
    const rows = page.list ?? [];
    list.push(...rows);
    if (rows.length < pageSize || (page.total !== undefined && list.length >= page.total)) {
      return { ...page, current: 1, list };
    }
  }
}

/* ---------- 邮件预览 ---------- */

export interface MailPreview {
  subject?: string;
  html?: string;
  email?: string;
}
/** contentsIds 与 contentsId 都要传:前者是全集,后者是这次要渲染的那一个 */
export const previewMail = (cid: string, contentsIds: string[], contentsId: string) =>
  postEnvelope<MailPreview | undefined>('/marketing/task-preview', {
    cid,
    contentsIds,
    contentsId,
  });

/* ---------- 「其他设置」的默认值 ---------- */

/**
 * 后端存的是 `{ status, value }` 这种开关+值的形状,不是扁平值 ——
 * 界面上每一项都是「开关 + 开了才出现的输入框」,存的就是这个形状。
 * 注意 **aiGuard 不在里面**:它跟着任务走,不进默认设置。
 */
export interface Toggle<T = never> {
  status: boolean;
  value?: T;
}
export interface MassConfig {
  track?: Toggle;
  attNormal?: Toggle;
  proxy?: Toggle;
  fromName?: Toggle<string>;
  replyTo?: Toggle<string>;
  timeSleep?: Toggle<number>;
}
export const getMassConfig = () =>
  postEnvelope<MassConfig | undefined>('/tasks/get-mass-config', {});
export const saveMassConfig = (c: MassConfig) =>
  postEnvelope<unknown>('/tasks/save-mass-config', { ...c });

/** 发信间隔的合法区间,老项目在 onBlur 里夹逼 */
export const TIME_SLEEP_MIN = 10;
export const TIME_SLEEP_MAX = 7200;
export const FROM_NAME_MAX = 128;

/** 把「开关+值」折叠回草稿里的扁平字段:开关关着就回落到默认值 */
export function applyMassConfig(
  c: MassConfig,
): Pick<MassDraft, 'track' | 'attNormal' | 'proxy' | 'fromName' | 'replyTo' | 'timeSleep'> {
  return {
    track: !!c.track?.status,
    attNormal: !!c.attNormal?.status,
    proxy: !!c.proxy?.status,
    fromName: c.fromName?.status ? (c.fromName.value ?? '') : '',
    replyTo: c.replyTo?.status ? (c.replyTo.value ?? '') : '',
    timeSleep: c.timeSleep?.status ? (c.timeSleep.value ?? 60) : 60,
  };
}

/** 回信邮箱的服务端校验。失败时 message 就是给用户看的原因 */
export const checkEmailAddress = (email: string) =>
  postEnvelope<unknown>('/tools/email-address-check', { email });

/* ---------- 提交 ---------- */

/**
 * 建任务。失败码要分开处理,不能一律弹 message:
 * - 515 点数不足 —— 要引导充值,并告诉还差多少
 * - 616 免费用户并发上限 —— 要引导升级会员
 */
export const MASS_ADD_CODE = { insufficient: 515, freeLimit: 616 } as const;

/**
 * 提交给后端的字段白名单。老项目是把整个草稿原样 POST 出去的,
 * 于是「再次发送」会把原任务的 gtid 和六十来个只读统计字段(send_count、
 * progress、userid…)一起当成新建参数发回去 —— 这里只发真正的输入字段。
 */
const SUBMIT_KEYS = [
  'name',
  'mode',
  'match',
  'exclude',
  'contentsIds',
  'attIds',
  'filters',
  'logic',
  'keyword',
  'selectOption',
  'selectSort',
  'selectKeys',
  'selectTotal',
  'skipNum',
  'limitNum',
  'channel',
  'senders',
  'track',
  'timeSleep',
  'fromName',
  'replyTo',
  'proxy',
  'attNormal',
  'sendAtOnce',
  'timeStart',
  'aiGuard',
] as const satisfies readonly (keyof MassDraft)[];

export const massSubmitBody = (d: MassDraft): Record<string, unknown> =>
  Object.fromEntries(SUBMIT_KEYS.map((k) => [k, d[k]]));

export const addMassTask = (d: MassDraft) =>
  postEnvelope<unknown>('/tasks/mass/add', massSubmitBody(d));

/**
 * 点数不足时还差多少。老项目这里用的是 selectTotal ——
 * 设了「跳过 / 最多发送」之后要充的点数其实没那么多,数字会偏大。
 * 这里传实际发送数。
 */
export const creditShortfall = (need: number, owned: number) => Math.max(0, need - owned);
