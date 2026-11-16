import { postEnvelope } from '@/api/auth';
import { fetchJson } from '@/api/client';
import type { BlackParams, FilterCondition } from '@/api/crm';
import { isUnknown } from '@/data/sentinels';

/**
 * AI 数据库(企业数据库)契约。路径与字段照搬 laifaxin-web,几处口径坑原样保留并加注:
 * - 分页参数叫 **current**(1 起)不叫 page;信封是 **{list, total}** 不是 {data}
 * - 匹配度有**两套口径**:行上的 _score 是 0~1 浮点,筛选发的 matchScore 是 50~100 整数
 * - 国家与规模的「未知」哨兵值拼作 **unkown**(少个 n),不是笔误,别顺手改
 * - 产品重命名的路径是 inference-product-**R**ename,大写 R
 * - 点数是整数「点」,不是分,不除 100
 */

/* ---------- 视图 ---------- */

/** 所有 views 接口的 type 常量(旧项目 config/view-config.ts) */
export const VIEW_TYPE_COMPANY = 'companyDbSearch';

/** 'all' 是「所有企业」这个内置视图的特殊 id */
export const ALL_VIEW_ID = 'all';

export interface ViewItem {
  viewId?: string;
  name?: string;
  editable?: boolean;
}

export interface ViewGroups {
  mineViews?: ViewItem[];
  othersViews?: ViewItem[];
  systemViews?: ViewItem[];
}

export interface ViewConfig {
  viewId?: string;
  name?: string;
  editable?: boolean;
  logic?: SearchLogic;
  filters?: FilterCondition[];
}

export const listViews = () =>
  postEnvelope<ViewGroups>('/views/views-list', { type: VIEW_TYPE_COMPANY });

export const getViewConfig = (viewId: string) =>
  postEnvelope<ViewConfig>('/views/view-config', { type: VIEW_TYPE_COMPANY, viewId });

/* ---------- 企业检索 ---------- */

export type SearchLogic = 'and' | 'or';

/** 匹配度筛选的下界硬性是 50 —— 界面上也明说「已默认过滤低于 50 分的企业」 */
export const MATCH_MIN = 50;
export const MATCH_MAX = 100;
export type MatchRange = [number, number];

export const DEFAULT_MATCH: MatchRange = [MATCH_MIN, MATCH_MAX];
export const isDefaultMatch = (r: MatchRange) => r[0] === MATCH_MIN && r[1] === MATCH_MAX;

export interface CompanySearchQuery {
  keyword: string;
  current: number;
  pageSize: number;
  /**
   * 只看某个任务产出的企业。**一个键承载两种业务 id**:批量搜索任务的 _id、
   * 客户保存记录的 _id —— 路由参数可以叫别的名字,请求体键名必须是这个。
   */
  refineTaskId?: string;
  logic?: SearchLogic;
  filters?: FilterCondition[];
  match?: MatchRange;
  /** 额度用尽后用户确认「继续查看」,按点扣费 */
  isCharge?: boolean;
  /** 本月自动扣点,免得每页都问 */
  autoCharge?: boolean;
}

/** 一行企业。旧项目全程 any,这里按实际读到的字段收敛 —— 未列出的字段后端仍可能回 */
export interface CompanyRow {
  /** 企业主键。选中、详情、找相似、评分、黑名单全用它 */
  id?: string;
  isBlack?: boolean;
  /** ISO alpha-2;空或 'unkown' 表示未知 */
  country_code?: string;
  company_name?: string;
  domain?: string;
  summary_zh?: string;
  /** **0~1 的浮点**,展示要 ×100。后端若改成 0-100,展示条件会让它整个消失而不是显示错值 */
  _score?: number;
  emailsCount?: number;
  emailSaved?: number;
  phones?: string[];
  entity_category?: string;
  client_focus?: string;
  naics_code?: string;
  naics_label?: string;
  /** 'unkown' 表示未知(原样拼错) */
  company_size?: string;
  industry?: string;
  linkedin_url?: string;
  facebook_url?: string;
  twitter_url?: string;
  instagram_url?: string;
  youtube_url?: string;
  tiktok_url?: string;
  whatsapp_url?: string;
  /** c_id 存在 = 该企业已存进通讯录;改标签用的是 c_id,**不是** id */
  company?: { c_id?: string; tags?: string[] };
}

export interface CompanySearchData {
  list?: CompanyRow[];
  total?: number;
  /** 全库企业总数,筛选栏的「总计 X.XM」 */
  all?: number;
  domain?: string;
  /** 搜索转后台:结果稍后才有 */
  waiting?: boolean;
  /** 目标网站的 HTTP 状态,>=400 表示网址打不开 */
  status_code?: number;
  dailyUsedUp?: boolean;
  monthlyUsedUp?: boolean;
}

/** 超额被拦下时抛这个,携带 data 让界面能区分「日额度」还是「月额度」 */
export class QuotaError extends Error {
  readonly scope: 'daily' | 'monthly';
  constructor(scope: 'daily' | 'monthly', message: string) {
    super(message);
    this.name = 'QuotaError';
    this.scope = scope;
  }
}

/** 后端的「未知」哨兵。定义在 @/data/sentinels,别在这里再写一份字面量 */
export const isUnknownValue = (v: string | undefined) => isUnknown(v);

/**
 * 企业检索。**不能**走 postEnvelope 的失败语义:额度用尽时后端回的是
 * `{success:false, data:{dailyUsedUp:true}}` —— data 在 success:false 时才有意义,
 * 而 postEnvelope 会在 !success 时抛错并把 data 整个丢掉,界面就无从分辨
 * 「今天用完了」和「搜索失败了」,只能一律显示失败。旧项目为此专门 skipErrorHandler。
 */
export async function searchCompanies(q: CompanySearchQuery): Promise<CompanySearchData> {
  const keyword = q.keyword.trim();
  const match = q.match ?? DEFAULT_MATCH;
  const res = await fetchJson<{ success: boolean; message?: string; data?: CompanySearchData }>(
    '/refine/company-list',
    {
      method: 'POST',
      body: JSON.stringify({
        keyword,
        current: q.current,
        pageSize: q.pageSize,
        logic: q.logic ?? 'and',
        filters: q.filters ?? [],
        sort: {},
        // 无关键词时强制传 {} —— 照旧项目 `filter: keyword ? filter : {}`。
        // 空搜索带着匹配度条件发过去会把「浏览全库」变成「筛过的全库」
        filter: keyword ? { matchScore: match } : {},
        ...(q.refineTaskId ? { refineTaskId: q.refineTaskId } : {}),
        ...(q.isCharge ? { isCharge: true } : {}),
        ...(q.autoCharge ? { autoCharge: true } : {}),
      }),
    },
  );
  if (!res.success) {
    if (res.data?.dailyUsedUp) throw new QuotaError('daily', res.message ?? '');
    if (res.data?.monthlyUsedUp) throw new QuotaError('monthly', res.message ?? '');
    throw new Error(res.message ?? '');
  }
  return res.data ?? {};
}

/**
 * 加入 / 移出黑名单。**范围由 selectOption + selectTotal 决定**,`selectKeys` 只是
 * 当前页勾中的 id —— 后端拿同一套 filters/keyword/logic 重跑查询再取前 N 条或全量。
 *
 * `refineTaskId` 一个键承载两种业务 id:批量搜索任务的 _id、客户保存记录的 _id。
 * 路由参数可以叫别的名字,**请求体键名必须是 refineTaskId**。
 *
 * 老项目这一族还有另外几个端点(`/api/clues/company-black` 线索列表、
 * `/api/search/tasks/black-save` 旧搜索任务结果),对应的页面本项目不迁,
 * 请求体与这个完全一致,将来要用直接换路径即可。
 */
export const blacklistRefineCompanies = (p: BlackParams & { refineTaskId?: string }) =>
  postEnvelope<{ backendId?: string }>('/refine/company-black', p);

/** 行内「找相似」:把这一行解析成域名,再拿域名当关键词重搜 */
export const resolveDomainName = async (id: string): Promise<string> => {
  const data = await postEnvelope<{ domain?: string }>('/domain/resolve-domain-name', { id });
  return data?.domain ?? '';
};

/* ---------- 查看额度 ---------- */

export interface RefineBenefits {
  vip?: number;
  isOrg?: boolean;
  dailyLimit?: number;
  monthlyLimit?: number;
  dailyUsed?: number;
  monthlyUsed?: number;
  monthlyChargeCount?: number;
  monthlyAutoCharge?: boolean;
  svipClaimed?: boolean;
}

export const getRefineBenefits = () => postEnvelope<RefineBenefits>('/benefits/refine-data', {});

/** 本月超额查看自动扣点，仅由用户主动切换设置时调用。 */
export const setRefineAutoCharge = (status: boolean) =>
  postEnvelope<unknown>('/benefits/refine-auto-charge', { status });

/** 免费用户只能翻前 3 页。页码看得见、点得动,但第 4 页起换成升级提示而不是发请求 */
export const FREE_MAX_PAGE = 3;
export const isFreeUser = (b: RefineBenefits | undefined) => !b?.vip;

/* ---------- AI 客群推演 ---------- */

export interface InferenceProduct {
  _id?: string;
  /** 用户最初输入的原始词 */
  product_name?: string;
  product_zh?: string;
  product_en?: string;
  /** 用户重命名后的方案名,展示时优先于 product_name */
  name?: string;
  /** 历史上可能是字符串数组,也可能是对象数组 */
  segments?: (string | { segment_name?: string })[];
  update_time?: number | string;
}

export interface InferenceProfile {
  product_zh?: string;
  product_en?: string;
  product_desc_zh?: string;
  product_exclusions?: string;
}

export interface SegmentItem {
  _id?: string;
  segment_name?: string;
  segment_definition?: string;
  ai_reason?: string;
  /** 唯一会被写回检索框的字段 */
  query_en?: string;
}

/** 方案名的展示口径:重命名优先,否则用最初输入的原始词 */
export const productLabel = (p: InferenceProduct | undefined) => p?.name || p?.product_name || '';

/** 客群 chip 的文案。segments 元素可能是字符串也可能是对象 */
export const segmentLabel = (s: string | { segment_name?: string } | undefined) =>
  typeof s === 'string' ? s : (s?.segment_name ?? '');

/** 两个 AI 动作各扣 2 点。旧项目把它写死在按钮文案里,这里至少收成一个常量 */
export const INFERENCE_COST = 2;

/** 一个产品下最多 100 个客群 */
export const SEGMENT_LIMIT = 100;

export const listInferenceProducts = async (): Promise<InferenceProduct[]> => {
  // 这个接口**没有分页**,回的是扁平数组而不是 {list} 信封
  const data = await postEnvelope<InferenceProduct[] | undefined>(
    '/profile/inference-product-list',
    {},
  );
  return data ?? [];
};

export const addInferenceProduct = (product_name: string) =>
  postEnvelope<InferenceProduct>('/profile/inference-product-add', { product_name });

export const getInferenceProfile = (product_id: string) =>
  postEnvelope<InferenceProfile>('/profile/inference-product-details', { product_id });

export const saveInferenceProfile = (product_id: string, patch: InferenceProfile) =>
  postEnvelope<unknown>('/profile/inference-product-save', { product_id, ...patch });

export const deleteInferenceProduct = (product_id: string) =>
  postEnvelope<unknown>('/profile/inference-product-delete', { product_id });

/** 路径里的 Rename 是**大写 R** —— 八个接口里唯一不守 kebab-case 的,写小写必然 404 */
export const renameInferenceProduct = (product_id: string, name: string) =>
  postEnvelope<unknown>('/profile/inference-product-Rename', { product_id, name });

export const listSegments = async (product_id: string): Promise<SegmentItem[]> => {
  const data = await postEnvelope<SegmentItem[] | undefined>('/profile/inference-segment-list', {
    product_id,
  });
  return data ?? [];
};

export const generateSegments = (product_id: string) =>
  postEnvelope<unknown>('/profile/inference-segment-generate', { product_id });
