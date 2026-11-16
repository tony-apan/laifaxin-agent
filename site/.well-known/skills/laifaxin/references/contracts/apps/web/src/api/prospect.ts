import { postEnvelope } from '@/api/auth';
import { fetchJson } from '@/api/client';
import type { BaseParams, FilterCondition, Logic, SelectionState, SelectOption } from '@/api/crm';
import type { PageResult } from '@/api/expenses';

/**
 * 搜客引擎(除 AI 数据库外)的契约:两个检索落地页、领英搜索、批量搜索任务、客户保存记录。
 * 路径与字段照搬 laifaxin-web,几处口径坑原样保留并加注:
 * - 「未知」哨兵值一律拼作 **unkown**(少个 n),字段名也是(unkownSave/unkownCost),别顺手改
 * - 消费额度在后端是**负数**(有效邮箱 -2、未知 -1、无效 0),是余额变化量不是花费绝对值
 * - 批量任务的 createAt 是 **ISO 字符串**,保存记录的 create_time 是**毫秒数**,两种都要能吃
 * - 任务行主键 _id、请求参数 taskId/saveId、公司结果行主键 id,三套命名并存
 * - 点数是整数「点」,不除 100
 */

/* ---------- 公司预览与背调(两个检索落地页共用) ---------- */

/** 检索落地页的两种口径:按域名/网址找,还是按公司名找。接口相同,文案与热词不同 */
export type ProspectMode = 'domain' | 'name';

/** 关键词下限。注意旧项目提交时不 trim、联想时 trim,这里统一 trim */
export const KEYWORD_MIN = 3;
export const KEYWORD_MAX = 512;

export interface PreviewCompany {
  id?: string;
  domain?: string;
  /** 下划线命名,和同一对象里驼峰的 emailCount 混用 —— 照抄,别统一 */
  company_name?: string;
  country_code?: string;
  summary_zh?: string;
  emailCount?: number;
}

export interface PreviewResult {
  list: PreviewCompany[];
  /** 后端从关键词里解析出的域名。非空表示「你输的就是个域名」,可直接背调 */
  domain: string;
}

/** 输入联想。**没有分页信封**,回的是 {list, domain} */
export const previewCompanies = async (name: string): Promise<PreviewResult> => {
  const data = await postEnvelope<{ list?: PreviewCompany[]; domain?: string } | undefined>(
    '/refine/company-list-by-name',
    { name },
  );
  return { list: data?.list ?? [], domain: data?.domain ?? '' };
};

/** 与联想接口同样返回 {list, domain}；公司名称可能对应多家公司，不能丢掉候选。 */
export const resolveCompany = async (name: string): Promise<PreviewResult> => {
  const data = await postEnvelope<Partial<PreviewResult> | undefined>(
    '/refine/company-info-by-name',
    { name },
  );
  return { list: data?.list ?? [], domain: data?.domain ?? '' };
};

/* ---------- 公司背调详情 ---------- */

export interface CompanyPhone {
  number?: string;
}

/** /domain/base-info 的返回。字段取自旧项目 company-overview-card 的解构 */
export interface CompanyDetail {
  id?: string;
  domain?: string;
  company_name?: string;
  emailCount?: number;
  country_code?: string;
  summary_zh?: string;
  summary_en?: string;
  naics_code?: string;
  naics_label?: string;
  client_focus?: string;
  entity_category?: string;
  isBlack?: boolean;
  phones?: CompanyPhone[];
  company_size?: string;
  company_address?: string;
  founded_year?: string | number;
  linkedin_url?: string;
  facebook_url?: string;
  twitter_url?: string;
  instagram_url?: string;
  youtube_url?: string;
  tiktok_url?: string;
  whatsapp_url?: string;
  similarCount?: number;
  employeeCount?: number;
  employees_url?: string;
  employees_at?: {
    linkedin_username?: string;
    linkedin_url?: string;
    name?: string;
    Headline?: string;
    logo_url?: string;
  }[];
  company?: { c_id?: string; tags?: string[] };
  aiScores?: { product_id?: string; score?: number }[];
}

export interface SimilarCompany extends CompanyDetail {
  _score?: number;
}

/** 额度用尽时抛这个,携带日/月的区分 */
export class ViewQuotaError extends Error {
  readonly scope: 'daily' | 'monthly';
  constructor(scope: 'daily' | 'monthly', message: string) {
    super(message);
    this.name = 'ViewQuotaError';
    this.scope = scope;
  }
}

/**
 * 公司背调。和企业检索一样**不能**走 postEnvelope 的失败语义:
 * 额度用尽时后端回 {success:false, data:{dailyUsedUp:true}},data 只在失败时才有意义,
 * 而 postEnvelope 会把它丢掉,界面就分不清「今天看够了」和「查询失败了」。
 * 旧项目为此专门 skipErrorHandler。
 */
export async function getCompanyDetail(
  domainOrId: string,
  charge?: { isCharge?: boolean; autoCharge?: boolean },
): Promise<CompanyDetail> {
  const res = await fetchJson<{
    success: boolean;
    message?: string;
    data?: CompanyDetail & { dailyUsedUp?: boolean; monthlyUsedUp?: boolean };
  }>('/domain/base-info', {
    method: 'POST',
    // 字段名是 domain,但后端要能同时吃域名字符串和公司 id —— 旧项目变量就叫 domainOrId
    body: JSON.stringify({ domain: domainOrId, ...charge }),
  });
  if (!res.success) {
    if (res.data?.dailyUsedUp) throw new ViewQuotaError('daily', res.message ?? '');
    if (res.data?.monthlyUsedUp) throw new ViewQuotaError('monthly', res.message ?? '');
    throw new Error(res.message ?? '');
  }
  return res.data ?? {};
}

/** 相似公司。背调面板里的「相似企业」 */
export const listSimilarCompanies = async (domain: string): Promise<SimilarCompany[]> => {
  const data = await postEnvelope<{ list?: SimilarCompany[] } | SimilarCompany[] | undefined>(
    '/domain/similar-list',
    { domain },
  );
  if (Array.isArray(data)) return data;
  return data?.list ?? [];
};

/* ---------- 批量搜索任务 ---------- */

export type TaskType = ProspectMode;

/** 后端的任务状态值域。aborted 与 deleted 都是「已取消」,domains 归到「运行中」 */
export type TaskStatus =
  | 'waiting'
  | 'running'
  | 'continue'
  | 'finished'
  | 'paused'
  | 'aborted'
  | 'deleted'
  | 'domains'
  | 'error';

/** 状态归一:旧项目两处映射不一致(running 一处叫「任务中」一处叫「运行中」),这里收成一份 */
export function taskStatusKey(status: string | undefined): TaskStatus | 'unknown' {
  switch (status) {
    case 'finished':
    case 'waiting':
    case 'running':
    case 'paused':
    case 'continue':
      return status;
    case 'domains':
      return 'running';
    case 'aborted':
    case 'deleted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

export interface RefineTask {
  _id?: string;
  name?: string;
  type?: TaskType;
  status?: string;
  /** 域名总数 */
  total?: number;
  validSave?: number;
  /** unknown 少个 n,前后端与数据库三方一致地这么拼 */
  unkownSave?: number;
  invalidSave?: number;
  validCost?: number;
  unkownCost?: number;
  invalidCost?: number;
  /** **ISO 字符串**(Mongo Date 序列化),不是毫秒数 —— 用 Number() 解析会直接炸 */
  createAt?: string;
  content?: string;
  userid?: string;
}

/** 三档保存数之和 */
export const taskSaveTotal = (t: RefineTask) =>
  (t.validSave ?? 0) + (t.unkownSave ?? 0) + (t.invalidSave ?? 0);

/**
 * 三档消费之和。后端存的是**负数**(有效 -2/个、未知 -1/个、无效 0),
 * 即「余额变化量」。界面要给用户看「花了多少」,所以取绝对值 —— 这是有意的口径转换,
 * 不是把负号当成脏数据抹掉。
 */
export const taskCostTotal = (t: RefineTask) =>
  Math.abs((t.validCost ?? 0) + (t.unkownCost ?? 0) + (t.invalidCost ?? 0));

export interface TaskListQuery {
  current: number;
  pageSize: number;
  keyword?: string;
  filter?: { status?: string[]; type?: string[]; owners?: string[] };
  sort?: Record<string, 1 | -1>;
  [k: string]: unknown;
}

/** 名字带 Refine 前缀:顶栏「我的任务」那边也有个 listTasks,同名会撞车 */
export const listRefineTasks = (q: TaskListQuery) =>
  postEnvelope<PageResult<RefineTask>>('/refine/task-list', q);

export const createTask = (body: { type: TaskType; content: string; name: string }) =>
  postEnvelope<{ taskId?: string }>('/refine/task-create', body);

export const getTaskStatus = (taskId: string) =>
  postEnvelope<{ status?: string }>('/refine/task-status', { taskId });

export const getTaskInfo = (taskId: string) =>
  postEnvelope<RefineTask>('/refine/task-info', { taskId });

export const renameTask = (taskId: string, name: string) =>
  postEnvelope<unknown>('/refine/task-rename', { taskId, name });

export const deleteTask = (taskId: string) =>
  postEnvelope<unknown>('/refine/task-delete', { taskId });

export const deleteTasks = (taskIds: string[]) =>
  postEnvelope<unknown>('/refine/tasks-delete', { taskIds });

/* ---------- 批量输入解析(照搬 utils/search.ts 的口径) ---------- */

const DOMAIN_RE = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/gi;
/**
 * 要剔掉的**文件后缀**,照抄旧项目 checkBadDomain 的清单。
 * 正则会把 `logo.png`、`report.pdf`、`index.html` 一律当成域名捞出来 ——
 * 用户从表格或网页里粘一段文本,这类文件名混进去就成了搜不到东西的假域名。
 * 注意这里过滤的是后缀,**不是邮箱服务商**:gmail.com 这类在旧项目里是留下的。
 */
const BAD_SUFFIX = /\.(txt|php|js|doc|docx|xlx|xlsx|png|jpg|jpef|html|xml|pdf|ico|img|csv)$/i;

/** 从任意文本里抠域名:转小写、去 www.、正则匹配、去重、剔掉文件名 */
export function parseDomains(text: string): string[] {
  const hit = text.toLocaleLowerCase().replace(/www\./g, '').match(DOMAIN_RE) ?? [];
  return [...new Set(hit)].filter((d) => !BAD_SUFFIX.test(d));
}

/** 从文本里抠公司名:按行拆、trim、**至少 3 字符**、去重 */
export function parseNames(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length >= KEYWORD_MIN),
    ),
  ];
}

/** 批量任务的条数上限。旧项目只在按钮上写了「MAX 10000」却没有任何校验 */
export const BATCH_MAX = 10000;

/* ---------- 领英搜索 ---------- */

/** 关键词可以命中的四个字段 */
export const LINKEDIN_KEYWORD_FIELDS = [
  'name',
  'domain',
  'short_description',
  'specialties',
] as const;
export type LinkedinKeywordField = (typeof LINKEDIN_KEYWORD_FIELDS)[number];

/** 领英的关键词上限是 128,比落地页的 512 短 */
export const LINKEDIN_KEYWORD_MAX = 128;

/** 公司规模的值域。**千位逗号是值的一部分**,去掉就匹配不上 */
export const COMPANY_SIZES = [
  '1',
  '2-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1,000',
  '1,001-5,000',
  '5,001-10,000',
  '10,001+',
] as const;

export interface LinkedinCompany {
  /** 主键是 id,不是 _id */
  id?: string;
  name?: string;
  domain?: string;
  website?: string;
  link?: string;
  logo_url?: string;
  short_description?: string;
  keywords?: string;
  industry?: string;
  company_size?: string;
  company_country?: string;
  /** ISO alpha-2 */
  company_code?: string;
  company_state?: string;
  company_city?: string;
  company_address?: string;
  linkedin_url?: string;
  black?: boolean;
  saveTotal?: number;
  /** 后端把命中的片段包在 <em> 里 */
  highlight?: { name?: string | string[]; short_description?: string | string[] };
}

/**
 * 简单 / 高级两种模式。
 *
 * **两者打的是同一个接口、同一组 9 个请求键**,差别只在四个值是写死还是让用户定:
 * `viewId` / `logic` / `pageSize` / `sort`。简单模式的三个快捷下拉,展开之后
 * 就是高级模式里三条 `include` 条件 —— 所以下面只有一个 `linkedinBody()`,
 * 不做两套。旧项目为此写了四个字段集合两两不同的构造函数,
 * 结果是同一屏上「看到的结果」和「批量操作的范围」可以不一致(见 B10/B14)。
 */
export type LinkedinMode = 'simple' | 'advanced';

export interface LinkedinQuery {
  mode: LinkedinMode;
  keyword: string;
  keywordFields: LinkedinKeywordField[];
  /** 精准匹配:把关键词包进英文双引号 */
  exact: boolean;
  /** 简单模式的三个快捷条件 */
  industries: string[];
  countries: string[];
  sizes: string[];
  /** 高级模式:任意字段的多条件。只有一层扁平 and/or,没有嵌套分组 */
  filters: FilterCondition[];
  logic: Logic;
  viewId: string;
  current: number;
  pageSize: number;
  sort: Record<string, 1 | -1>;
}

export interface LinkedinResult {
  list?: LinkedinCompany[];
  total?: number;
  /** 全库总数 */
  all?: number;
  /** gte 表示 total 只是下限,界面要说「大于」 */
  relation?: 'eq' | 'gte';
}

/**
 * 结果上限。后端超过这个数只回下限,再往后翻页拿不到东西 ——
 * 旧项目只在简单模式封顶,高级模式照 total 算页数,于是高级模式能翻到空页。
 * 这是后端的限制,不是某个模式的限制,所以两边一起封。
 */
export const LINKEDIN_TOTAL_CAP = 10000;

/** 每页条数的可选档位 */
export const LINKEDIN_PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * 发给后端的条件数组。简单模式把三个快捷下拉翻译成条件,高级模式直接用用户编的。
 * 算子用的是 ES 那一套(`include` 而不是 `anyInclude`),见 api/crm.ts 的 ES_OPERATORS。
 */
export function linkedinFilters(q: LinkedinQuery): FilterCondition[] {
  if (q.mode === 'advanced') return q.filters;
  const out: FilterCondition[] = [];
  // values 为空的条件整条不发 —— 发空数组后端会当成「必须匹配空值」
  if (q.industries.length)
    out.push({ property: 'industry', operator: 'include', values: q.industries });
  // 国家统一用 company_code + ISO 二字码:结果行的国旗也是按它渲染的。
  // 旧项目工具栏发 company_code、筛选弹窗发 company_country(英文国名),
  // 同一个「国家」条件写进同一个数组,两种编码互相看不见
  if (q.countries.length)
    out.push({ property: 'company_code', operator: 'include', values: q.countries });
  if (q.sizes.length) out.push({ property: 'company_size', operator: 'include', values: q.sizes });
  return out;
}

/** 精准匹配 = 整串被引号包住。判「首尾」而不是「含有一对引号」,`he"ll"o` 也要能被包 */
export function linkedinKeyword(q: LinkedinQuery): string {
  const kw = q.keyword.trim();
  return q.exact && kw && !/^".*"$/.test(kw) ? `"${kw}"` : kw;
}

/** 列表查询与批量操作共用的那一半请求体 —— 「作用于哪些公司」的唯一定义 */
function linkedinCriteria(q: LinkedinQuery) {
  return {
    viewId: q.viewId,
    logic: q.logic,
    keyword: linkedinKeyword(q),
    keyword_fields: q.keywordFields,
    /** 恒空的死字段,后端还在读 */
    filter: {},
    filters: linkedinFilters(q),
  };
}

export const linkedinBody = (q: LinkedinQuery) => ({
  ...linkedinCriteria(q),
  current: q.current,
  pageSize: q.pageSize,
  sort: q.sort,
});

export const searchLinkedin = (q: LinkedinQuery) =>
  postEnvelope<LinkedinResult>('/search/linkedin-company-v2-list', linkedinBody(q));

/**
 * 批量操作(黑名单 / AI 评分 / 保存联系人)的作用范围。
 *
 * `keys` 只是**当前页**勾中的 id,真实范围是 `option` + `total`:后端拿着同一套
 * 条件重跑查询再取前 N 条或全量。所以 `keys.length` 与 `total` 可以不相等,
 * 拿前者当选中数会把范围说错。条件必须和列表查询用的是同一份 —— 这就是
 * 上面 `linkedinCriteria()` 存在的理由。
 */
export function linkedinScope(
  q: LinkedinQuery,
  sel: SelectionState,
): BaseParams & { filter: Record<string, unknown>; viewId: string; keyword_fields: string[] } {
  return {
    ...linkedinCriteria(q),
    selectAll: sel.option === 'all',
    selectKeys: sel.keys,
    selectOption: sel.option,
    selectTotal: sel.total,
    // 批量接口的排序键叫 selectSort,查询接口叫 sort。两个键同一个值,
    // 从一处取,免得「按规模排序后取前 200 条」取到的是另一批
    selectSort: q.sort,
    sort: q.sort,
  };
}

/** 加/取消黑名单。作用范围同上,后端按条件重跑 */
export const blockLinkedin = (scope: BaseParams, action: 'add' | 'cancel') =>
  postEnvelope<unknown>(
    action === 'add'
      ? '/search/linkedin-company-save-black'
      : '/search/linkedin-company-cancel-black',
    scope,
  );

/**
 * 顶部显示的总数:一个条件都没有时展示全库量 `all`,一有条件就展示实际命中数。
 * 旧项目只有简单模式这么做,高级模式恒用 total —— 同一页两种口径,这里统一。
 */
export function linkedinDisplayTotal(res: LinkedinResult | undefined, q: LinkedinQuery): number {
  if (!res) return 0;
  const noCondition = !q.keyword.trim() && linkedinFilters(q).length === 0;
  return (noCondition ? res.all : res.total) ?? 0;
}

export type { SelectOption };

/** 把后端 <em> 高亮片段拆成「文本 + 是否命中」的段落 */
export function highlightParts(raw: string | string[] | undefined, fallback: string) {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return [{ text: fallback, hit: false }];
  return text
    .split(/(<em>.*?<\/em>)/g)
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith('<em>') ? { text: seg.slice(4, -5), hit: true } : { text: seg, hit: false },
    );
}

/* ---------- 客户保存记录 ---------- */

export type SaveStatus = 'total' | 'finished' | 'running' | 'paused' | 'waiting';

export interface SaveTask {
  _id?: string;
  name?: string;
  /** 产生这次保存的上游任务 id,名称为空时拿它兜底展示 */
  task_id?: string;
  companySave?: boolean;
  contactSave?: boolean;
  companyTags?: string[];
  contactTags?: string[];
  status?: string;
  total?: number;
  finished?: number;
  /** 每家公司最多保存几个联系人,1~1000 */
  contactMaxCount?: number;
  validCount?: number;
  unkownCount?: number;
  invalidCount?: number;
  validSave?: number;
  unkownSave?: number;
  invalidSave?: number;
  validCost?: number;
  unkownCost?: number;
  invalidCost?: number;
  message?: string;
  userid?: string;
  /** **毫秒时间戳**,与批量任务的 ISO 串 createAt 不是一回事 */
  create_time?: number;
  downUrl?: string;
  companyShow?: boolean;
}

export const saveEmailTotal = (t: SaveTask) =>
  (t.validCount ?? 0) + (t.unkownCount ?? 0) + (t.invalidCount ?? 0);
export const saveSavedTotal = (t: SaveTask) =>
  (t.validSave ?? 0) + (t.unkownSave ?? 0) + (t.invalidSave ?? 0);
/** 同样取绝对值:后端存的是负的余额变化量 */
export const saveCostTotal = (t: SaveTask) =>
  Math.abs((t.validCost ?? 0) + (t.unkownCost ?? 0) + (t.invalidCost ?? 0));

export interface SaveTaskCounts {
  total?: number;
  finished?: number;
  running?: number;
  paused?: number;
  waiting?: number;
}

export const listSaveTasks = (q: {
  current: number;
  pageSize: number;
  filter: { status: SaveStatus; keyword?: string };
  sort?: Record<string, 1 | -1>;
}) => postEnvelope<PageResult<SaveTask>>('/clues/company-save-list', q);

/** 保存记录没有单条详情接口。深链刷新时按现有列表接口分页查找,不受当前列表筛选影响。 */
export async function getSaveTaskInfo(
  saveId: string,
  signal?: AbortSignal,
): Promise<SaveTask | null> {
  const pageSize = 100;
  for (let current = 1; ; current++) {
    signal?.throwIfAborted();
    const data = await listSaveTasks({
      current,
      pageSize,
      filter: { status: 'total' },
      sort: { _id: -1 },
    });
    signal?.throwIfAborted();
    const list = data.list ?? [];
    const task = list.find((item) => item._id === saveId);
    if (task) return task;
    if (
      !list.length ||
      list.length < pageSize ||
      (data.total !== undefined && current * pageSize >= data.total)
    ) {
      return null;
    }
  }
}

export const getSaveTaskCounts = () =>
  postEnvelope<SaveTaskCounts>('/clues/company-save-count', {});

/** 五个动作的参数名都是 saveId,值是行的 _id */
export const renameSaveTask = (saveId: string, name: string) =>
  postEnvelope<unknown>('/clues/company-save-rename', { saveId, name });
export const startSaveTask = (saveId: string) =>
  postEnvelope<unknown>('/clues/company-save-start', { saveId });
export const stopSaveTask = (saveId: string) =>
  postEnvelope<unknown>('/clues/company-save-stop', { saveId });
export const endSaveTask = (saveId: string) =>
  postEnvelope<unknown>('/clues/company-save-end', { saveId });
export const downloadSaveTask = (saveId: string) =>
  postEnvelope<{ url?: string }>('/clues/company-save-download', { saveId });

/** finished 且没有结果文件、三档计数又都是 0 —— 下载出来会是空文件,不如直接拦住 */
export const saveResultEmpty = (t: SaveTask) =>
  t.status === 'finished' && !t.downUrl && saveEmailTotal(t) === 0;
