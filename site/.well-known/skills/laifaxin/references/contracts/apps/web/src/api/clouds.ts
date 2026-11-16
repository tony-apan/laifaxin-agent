import { postEnvelope, postEnvelopeFull } from '@/api/auth';
import type { SelectOption } from '@/api/crm';

/**
 * 插件云端数据。浏览器插件在谷歌地图/谷歌搜索上抓到的公司,同步到云端后在这里看。
 *
 * 两个页面结构对称,但**接口不在一处、功能也不对等**:
 *
 * |          | 谷歌地图                          | 谷歌搜索                     |
 * |----------|----------------------------------|-----------------------------|
 * | 控制器   | `search.ts` 的 `/search/map-*`    | `clouds.ts` 的 `/clouds/google-search/*` |
 * | 路由数   | 6(多出评分、按条件搜、导出)      | 4                           |
 * | 字段数   | 31(评分/坐标/营业时间/六个社媒)  | 9(域名/链接/标题/描述/语言) |
 *
 * 后端那两个 service(`ext/search.ts` 与 `ext/google-search.ts`)除了模型名
 * 几乎逐行相同 —— 复制粘贴出来的,细节上又各自漂移了一点。前端不跟着复制:
 * 共用的部分参数化,差异的部分显式列出来。
 */

/* ---------- 两种数据源 ---------- */

export const CLOUD_KINDS = ['map', 'search'] as const;
export type CloudKind = (typeof CLOUD_KINDS)[number];

/**
 * 每种数据源的接口路径与标签类型。
 *
 * 注意路径前缀不一样:地图挂在 `/search` 下、搜索挂在 `/clouds` 下 ——
 * 后端 `clouds.ts` 里那个处理函数还叫 `mapDataList`(复制粘贴没改名),
 * 别被函数名骗了。
 */
const ENDPOINTS = {
  map: {
    list: '/search/map-data-list',
    delete: '/search/map-data-delete',
    tags: '/search/map-data-tags',
    /** 只有地图有 */
    rating: '/search/map-data-rating',
    search: '/search/map-data-search',
    export: '/search/map-data-export',
    tagType: 'extMap',
  },
  search: {
    list: '/clouds/google-search/data-list',
    delete: '/clouds/google-search/data-delete',
    tags: '/clouds/google-search/data-tags',
    rating: null,
    search: null,
    export: null,
    tagType: 'extGoogleSearch',
  },
} as const;

export const cloudTagType = (kind: CloudKind) => ENDPOINTS[kind].tagType;
/** 这种数据源支不支持某个动作 —— 地图有评分和导出,搜索没有 */
export const cloudSupports = (kind: CloudKind, what: 'rating' | 'search' | 'export') =>
  ENDPOINTS[kind][what] !== null;

/* ---------- 分页 ---------- */

/**
 * ⚠️ **行在 `data.list` 里,不在 `data`。**
 *
 * 后端两个控制器都是 `return { success: true, data }`,而这个 `data` 本身是
 * `{ list, current, total, pageSize }` —— **没有摊平**。
 *
 * 这和企业模块那批**正好相反**:那边是 `return { ...data, success }`,
 * total 摊到了信封上。同一个后端两种写法,读错就是分页崩掉,
 * 所以这里单独写一个而不是复用 `enterprise-members.ts` 的 `pagedPost`。
 */
export interface CloudPage<T> {
  rows: T[];
  total: number;
  current: number;
  pageSize: number;
}

/**
 * `pageSize` 后端**越界不报错**:`pageSize > 0 && pageSize <= 100 ? pageSize : 15`,
 * 传 500 会静默变成 15。所以夹在这一层,免得用户以为自己选了 500 条。
 */
export const CLOUD_PAGE_MAX = 100;
export const clampCloudPageSize = (n: number) =>
  n > 0 && n <= CLOUD_PAGE_MAX ? Math.trunc(n) : 15;

export interface CloudQuery {
  current: number;
  pageSize: number;
  /** 关键词。后端按各自的字段集做模糊 */
  keyword?: string;
  /** 高级筛选。形状由字段配置决定,这一层不解释,原样透传 */
  filters?: unknown[];
  /** 多个筛选之间是且还是或 */
  logic?: 'and' | 'or';
  sort?: Record<string, 1 | -1>;
  /** 视图 id。'all' 表示不限视图 */
  viewId?: string;
}

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/* ---------- 行 ---------- */

/** 两种数据源共有的部分 */
export interface CloudRowBase {
  id: string;
  /** 插件在本地自动生成的序号,不是主键 */
  seq: number;
  domain: string;
  tags: string[];
  lang: string;
  createTime: number;
}

/** 谷歌地图:31 个字段里挑出界面真正要用的 */
export interface MapRow extends CloudRowBase {
  kind: 'map';
  name: string;
  logo: string;
  website: string;
  phone: string;
  rating: number;
  commentCount: number;
  category: string;
  fullAddress: string;
  countryCode: string;
  province: string;
  city: string;
  district: string;
  zipCode: string;
  placeId: string;
  placeCid: string;
  emails: string[];
  whatsapp: string;
  /** 五个社媒,界面上折成一组图标 */
  facebook: string;
  linkedin: string;
  twitter: string;
  instagram: string;
  youtube: string;
}

/** 谷歌搜索:后端只有 9 个字段 */
export interface SearchRow extends CloudRowBase {
  kind: 'search';
  title: string;
  link: string;
  description: string;
}

export type CloudRow = MapRow | SearchRow;

const base = (r: Record<string, unknown>): Omit<CloudRowBase, never> => ({
  id: str(r._id),
  seq: num(r.id),
  domain: str(r.domain),
  tags: strArr(r.tags),
  lang: str(r.lang),
  createTime: num(r.create_time),
});

export function normalizeMapRow(r: Record<string, unknown>): MapRow {
  return {
    ...base(r),
    kind: 'map',
    name: str(r.name),
    logo: str(r.logo),
    website: str(r.website),
    phone: str(r.phone),
    rating: num(r.rating),
    commentCount: num(r.commentCount),
    category: str(r.category),
    fullAddress: str(r.fullAddress),
    countryCode: str(r.countryCode),
    province: str(r.province),
    city: str(r.city),
    district: str(r.district),
    zipCode: str(r.zipCode),
    placeId: str(r.placeId),
    placeCid: str(r.placeCid),
    emails: strArr(r.emails),
    whatsapp: str(r.whatsapp),
    facebook: str(r.facebook),
    linkedin: str(r.linkedin),
    twitter: str(r.twitter),
    instagram: str(r.instagram),
    youtube: str(r.youtube),
  };
}

export function normalizeSearchRow(r: Record<string, unknown>): SearchRow {
  return {
    ...base(r),
    kind: 'search',
    title: str(r.title),
    link: str(r.link),
    description: str(r.description),
  };
}

/** 地图行有没有可联系的方式 —— 一行全是空的社媒图标很难看 */
export const mapContacts = (r: MapRow) =>
  [
    r.emails.length ? { key: 'email', value: r.emails[0] } : null,
    r.phone ? { key: 'phone', value: r.phone } : null,
    r.whatsapp ? { key: 'whatsapp', value: r.whatsapp } : null,
  ].filter((x): x is { key: string; value: string } => x !== null);

export const mapSocials = (r: MapRow) =>
  (
    [
      ['facebook', r.facebook],
      ['linkedin', r.linkedin],
      ['twitter', r.twitter],
      ['instagram', r.instagram],
      ['youtube', r.youtube],
    ] as const
  ).filter(([, url]) => !!url);

/* ---------- 读 ---------- */

export async function listCloudData(kind: CloudKind, q: CloudQuery): Promise<CloudPage<CloudRow>> {
  const body = {
    viewId: q.viewId ?? 'all',
    current: Math.max(1, Math.trunc(q.current) || 1),
    pageSize: clampCloudPageSize(q.pageSize),
    keyword: q.keyword ?? '',
    filters: q.filters ?? [],
    logic: q.logic ?? 'and',
    sort: q.sort ?? {},
  };
  const data = await postEnvelope<Record<string, unknown> | undefined>(ENDPOINTS[kind].list, body);
  const raw = (data ?? {}) as Record<string, unknown>;
  const list = Array.isArray(raw.list) ? raw.list : [];
  const map = kind === 'map' ? normalizeMapRow : normalizeSearchRow;
  return {
    rows: list.map((x) => map(x as Record<string, unknown>)),
    total: num(raw.total),
    current: num(raw.current, body.current),
    pageSize: num(raw.pageSize, body.pageSize),
  };
}

/* ---------- 写 ---------- */

/**
 * 批量动作的范围。**与 `api/crm.ts` 的 {@link BaseParams} 是同一套**,
 * 后端 `getQueryFromAdvancedFilter` 读的就是这些字段:
 *
 * - `current` 用 `selectKeys`(用户勾了哪几行)
 * - `front`   用 filters 取前 `selectTotal` 条
 * - `all`     用 filters 全量
 *
 * ⚠️ 所以**删除不一定是「删勾选的那几条」** —— 选了 all 就是删掉符合当前筛选的
 * 全部,而界面上用户看到的往往只是「已选 N 条」。这一步必须在确认框里说清楚,
 * 因为后端是直接 `deleteMany`,没有回收站。
 */
export interface CloudBatchScope {
  option: SelectOption;
  keys: string[];
  /** 用户认为自己选了多少条。与 keys.length 可以不相等 */
  total: number;
}

const batchBody = (scope: CloudBatchScope, q: CloudQuery) => ({
  viewId: q.viewId ?? 'all',
  selectOption: scope.option,
  selectKeys: scope.keys,
  selectTotal: scope.total,
  selectSort: q.sort ?? {},
  filters: q.filters ?? [],
  keyword: q.keyword ?? '',
  logic: q.logic ?? 'and',
});

/** 删除。**不可逆**,后端直接 deleteMany,没有回收站 */
export const deleteCloudData = (kind: CloudKind, scope: CloudBatchScope, q: CloudQuery) =>
  postEnvelopeFull<unknown>(ENDPOINTS[kind].delete, batchBody(scope, q));

/**
 * 贴 / 撕标签。
 *
 * ⚠️ **`tagAction` 的取值不是 add/remove。** DTO 上写的是 `push`/`pull`,
 * 但后端代码里只显式认这几个:
 *
 * ```js
 * if (tagAction === 'pull' || tagAction === 'del' || tagAction === 'delete') 撕
 * else if (tagAction === 'replace') 整组替换
 * else 贴            // ← push 走的是这一支,任何别的值也走这一支
 * ```
 *
 * 也就是说**「贴」是兜底分支**:拼错的值不会报错,会默默贴上去。
 * 所以这里把取值收成一个联合类型,不让调用方自由传字符串。
 */
export type TagAction = 'push' | 'pull' | 'replace';

export const tagCloudData = (
  kind: CloudKind,
  scope: CloudBatchScope,
  q: CloudQuery,
  tagAction: TagAction,
  tagValues: string[],
) =>
  postEnvelopeFull<unknown>(ENDPOINTS[kind].tags, {
    ...batchBody(scope, q),
    tagAction,
    tagValues,
  });

/** 地图商家按域名创建批量搜索任务，后端上限 10,000 条。 */
export const searchMapData = (scope: CloudBatchScope, q: CloudQuery) =>
  postEnvelope<unknown>(ENDPOINTS.map.search, batchBody(scope, q));
