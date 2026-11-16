import { postEnvelope } from '@/api/auth';
import type { BlackParams } from '@/api/crm';
import type { PageResult } from '@/api/expenses';

/**
 * 批量评分任务(AI 给公司按某个产品档案打分)。几处口径坑原样保留并加注:
 * - 任务主键 `_id`,但接口参数叫 `taskId` —— **唯独重命名那条叫 `id`**,别顺手统一
 * - 批量删除的参数是复数 `taskIds`
 * - 结果行的主键是 **domain**(域名字符串),不是 _id
 * - 时间是**毫秒数**(create_time / finish_time),不是 ISO 串
 * - 评分产品档案走 /profile/product-*(契约见 `@/api/products`),与 AI 客群推演的
 *   inference-product-* 是**两套不同的实体**(前者字段是 product_name/main_business,
 *   后者是 product_zh/product_en)
 */

/*
 * 产品档案的契约在 `@/api/products` —— 它在「设置」里有自己的管理页,
 * 评分这边只是消费方。
 */

/* ---------- 评分分档 ---------- */

/** 四档 + 未评分。阈值是闭区间下界,旧项目在四个地方各写了一遍 */
export type ScoreBand = 'top' | 'high' | 'middle' | 'low' | 'none';

export const SCORE_BANDS: { key: ScoreBand; min: number; max: number }[] = [
  { key: 'top', min: 85, max: 100 },
  { key: 'high', min: 75, max: 84 },
  { key: 'middle', min: 60, max: 74 },
  { key: 'low', min: 0, max: 59 },
];

/** 分数 → 档位。undefined / null / 负数都算未评分 */
export function scoreBand(score: number | undefined | null): ScoreBand {
  if (typeof score !== 'number' || Number.isNaN(score) || score < 0) return 'none';
  if (score >= 85) return 'top';
  if (score >= 75) return 'high';
  if (score >= 60) return 'middle';
  return 'low';
}

/* ---------- 评分任务 ---------- */

export type RatingStatus = 'waiting' | 'running' | 'paused' | 'finished' | 'aborted' | 'deleted';

/** 归一:aborted 与 deleted 都是「已取消」。旧项目筛选项里也没有这两个 */
export function ratingStatusKey(status: string | undefined): RatingStatus | 'unknown' {
  switch (status) {
    case 'waiting':
    case 'running':
    case 'paused':
    case 'finished':
      return status;
    case 'aborted':
    case 'deleted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

export interface RatingTask {
  _id?: string;
  name?: string;
  status?: string;
  userid?: string;
  product_info?: { product_name?: string };
  /** 实际参与评分的公司数 */
  total?: number;
  /** 提交时选中的总数。与 total 的差额就是被排除掉的 */
  selectTotal?: number;
  top_count?: number;
  high_count?: number;
  middle_count?: number;
  low_count?: number;
  exclude_count?: number;
  error_count?: number;
  cache_hit?: number;
  cache_miss?: number;
  costCount?: number;
  returnCount?: number;
  /** **毫秒数**,不是 ISO 串 */
  create_time?: number;
  finish_time?: number | null;
}

/** 四档计数 */
export const bandCounts = (t: RatingTask) => ({
  top: t.top_count ?? 0,
  high: t.high_count ?? 0,
  middle: t.middle_count ?? 0,
  low: t.low_count ?? 0,
});

/** 分母:提交时选了多少就以多少为准,没有 selectTotal 才退回 total */
export const ratingDenominator = (t: RatingTask) => (t.selectTotal || t.total) ?? 0;

/**
 * 已完成数 = 四档 + 出错 + 被跳过的。
 * 跳过数 = 提交数 − 实际参与数(排除黑名单/已评过等),照旧项目的口径。
 */
export function ratingFinished(t: RatingTask): number {
  const b = bandCounts(t);
  const skipped = t.selectTotal ? Math.max(0, t.selectTotal - (t.total ?? 0)) : 0;
  return b.top + b.high + b.middle + b.low + (t.error_count ?? 0) + skipped;
}

export function ratingProgress(t: RatingTask): number {
  const all = ratingDenominator(t);
  if (all <= 0) return 0;
  return Math.min(100, (ratingFinished(t) / all) * 100);
}

/**
 * 耗时。没跑完时算的是「已经跑了多久」,所以会随刷新增长 —— 这是旧项目的语义,
 * 保留:用户要的就是「这个任务跑了多久了」。
 */
export function ratingElapsed(t: RatingTask, now = Date.now()): number {
  if (!t.create_time) return 0;
  return (t.finish_time || now) - t.create_time;
}

/**
 * 扣点。旧项目是 costCount + returnCount 直接相加、**不取绝对值** ——
 * returnCount 看着像退款。与批量搜索任务那边「消费额度是负数」的口径不一样,
 * 所以这里不套用那边的 Math.abs,原样相加。
 */
export const ratingCost = (t: RatingTask) => (t.costCount ?? 0) + (t.returnCount ?? 0);

export interface RatingTaskQuery {
  current: number;
  pageSize: number;
  keyword?: string;
  filter?: { status?: string; productIds?: string[] };
  sort?: Record<string, 1 | -1>;
  [k: string]: unknown;
}

export const listRatingTasks = (q: RatingTaskQuery) =>
  postEnvelope<PageResult<RatingTask>>('/clues/rating-task-list', q);

export async function getRatingTaskInfo(taskId: string): Promise<RatingTask | null> {
  const task = await postEnvelope<RatingTask>('/clues/rating-task-info', { taskId });
  // 不存在的任务返回空对象,不能据此开放编辑入口。
  return task?._id ? task : null;
}

/** 唯一一条参数名叫 id 的 —— 其余都是 taskId */
export const renameRatingTask = (id: string, name: string) =>
  postEnvelope<unknown>('/clues/rating-task-rename', { id, name });

export const deleteRatingTasks = (taskIds: string[]) =>
  postEnvelope<unknown>('/clues/rating-task-delete', { taskIds });

export type RatingAction = 'start' | 'stop' | 'abort';

export const controlRatingTask = (action: RatingAction, taskId: string) =>
  postEnvelope<unknown>(`/clues/rating-task-${action}`, { taskId });

/* ---------- 评分结果 ---------- */

export interface RatingResultRow {
  /** 行主键是域名,不是 _id */
  domain?: string;
  orgName?: string;
  name?: string;
  link?: string;
  score?: number;
  comment?: string;
  chat_id?: string;
  /** 优先取它,没有才退回 chat_id */
  ai_chat_id?: string;
  isBlack?: boolean;
  emailSaved?: number;
  industry?: string;
  countryCode?: string;
  companySize?: string;
  companyInfo?: {
    logo_url?: string;
    summary_zh?: string;
    short_description?: string;
    country_code?: string;
    countryCode?: string;
    employees?: string;
    industry?: string;
    naics_label?: string;
    website?: string;
    linkedin_url?: string;
    emailsCount?: number;
  };
}

/** 自定义区间的形状是 "min-max" */
export const CUSTOM_RANGE_RE = /^\d+-\d+$/;

export interface RatingResultQuery {
  taskId: string;
  current: number;
  pageSize: number;
  /** 'top'|'high'|'middle'|'low'|'null'(未评分)|'50-100'(自定义区间) */
  scoreLevels: string[];
  sort?: Record<string, 1 | -1>;
  [k: string]: unknown;
}

export const listRatingResults = (q: RatingResultQuery) => {
  const { scoreLevels, ...rest } = q;
  return postEnvelope<PageResult<RatingResultRow>>('/clues/rating-result-list', {
    ...rest,
    filters: [],
    logic: 'and',
    keyword: '',
    filter: { scoreLevels },
  });
};

/* ---------- AI 分析报告 ---------- */

export interface ReportDimension {
  score?: number;
  reasoning?: string;
}

export interface RatingReport {
  match_analysis?: {
    match_score?: number;
    key_matching_points?: { positives?: string[]; risks?: string[] };
    detailed_breakdown?: Record<string, ReportDimension>;
  };
}

/** 报告的六个维度,顺序即展示顺序 */
export const REPORT_DIMENSIONS = [
  'business_relevance',
  'supply_chain_role',
  'brand_fit',
  'company_scale_fit',
  'operational_activity',
  'synergy_and_hook_point',
] as const;

/** 响应是 data.data 两层嵌套,别少解一层 */
export const getRatingReport = async (chatId: string): Promise<RatingReport | null> => {
  const data = await postEnvelope<{ data?: RatingReport } | undefined>(
    '/search/tasks/ai-rating-chat-info',
    { chat_id: chatId },
  );
  return data?.data ?? null;
};

/* ---------- 发起评分(8 个来源共用一套参数,只换端点) ---------- */

/** AI 评分每家 1 点 */
export const RATING_COST_PER_COMPANY = 1;

export interface RatingOtherParams {
  excludeBlacklist: boolean;
  excludeCustomerCompany: boolean;
  /** forced 为真时后端会忽略它,前端也要跟着置 false,免得两边说法不一 */
  excludeScoredCompany: boolean;
}

export interface CreateRatingBody {
  product_id: string;
  /** false=智能扫描(跳过评过的) true=全面扫描(全部重评) */
  forced: boolean;
  /** 旧项目写死 3,没有第二个取值 */
  ai_level: 3;
  saveSelect: false;
  saveTags: string[];
  saveOption: 'add' | 'replace' | 'nothing';
  otherParams: RatingOtherParams;
  [k: string]: unknown;
}

/** 发起评分的来源。每个来源一个端点,参数形状相同 */
export type RatingSource = 'refine' | 'linkedin' | 'ratingTask';

const RATING_ENDPOINT: Record<RatingSource, string> = {
  refine: '/refine/company-rating',
  linkedin: '/search/linkedin-company-rating',
  // 结果页里对选中的公司换个产品档案重评
  ratingTask: '/clues/rating-result-rating-again',
};

export function ratingBody(form: {
  productId: string;
  forced: boolean;
  other: RatingOtherParams;
}): CreateRatingBody {
  return {
    product_id: form.productId,
    forced: form.forced,
    ai_level: 3,
    saveSelect: false,
    saveTags: [],
    saveOption: 'nothing',
    otherParams: {
      ...form.other,
      // 全面扫描的语义就是「评过的也重评」,这时候再说「排除已评分」是自相矛盾
      excludeScoredCompany: form.forced ? false : form.other.excludeScoredCompany,
    },
  };
}

export const createRating = (
  source: RatingSource,
  body: CreateRatingBody & Record<string, unknown>,
) => postEnvelope<{ taskId?: string }>(RATING_ENDPOINT[source], body);

/**
 * 评分结果的加入 / 移出黑名单。请求体与其它业务面**完全同构**(见 api/crm.ts 的
 * `BlackParams`),只多一个 `taskId` —— 注意是驼峰,不是搜索任务那边的 `task_id`。
 *
 * `filter.scoreLevels` 必须和列表查询同源:范围选「全部」时后端拿它重跑,
 * 只传范围不传档位的话,作用到的是整个任务而不是用户看到的那几档。
 */
export const blacklistRatingResults = (
  p: BlackParams & { taskId: string; scoreLevels: string[] },
) => {
  const { scoreLevels, ...rest } = p;
  return postEnvelope<{ backendId?: string }>('/clues/rating-result-save-black', {
    ...rest,
    filter: { scoreLevels },
  });
};
