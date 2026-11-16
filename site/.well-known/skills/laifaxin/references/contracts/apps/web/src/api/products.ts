import { postEnvelope } from '@/api/auth';
import type { PageResult } from '@/api/expenses';

/**
 * 设置 · 产品档案。AI 匹配度评分拿它当"我是谁、我要找谁"的依据。
 *
 * **`/profile/` 下有两族互不相干的产品接口,别混:**
 * - `/profile/product-*`(本模块)—— 产品档案,字段是 `product_name / main_business / …`
 * - `/profile/inference-product-*`(`@/api/refine`)—— AI 客群推演的获客方案,
 *   字段是 `product_zh / product_en / …`。两套零字段互通、零 id 互通
 *
 * 与老项目的差异:
 * - **主键对外一律 `id`**。后端读回来是 `_id`、写出去叫 `id`、新增响应又是 `data.id`,
 *   下游评分接口还有 `product_id` / `productId` / `productIds` 三种拼写 —— 都在这一层收敛
 * - **新增与编辑共用一份表单契约**。老项目是两个逐字复制的文件,唯一差异是标题和接口
 * - **可选字段一律发 `''`**。老项目新增发空串、编辑时 undefined 的键直接消失,
 *   后端要是区分「没传」和「空值」,两条路径的行为就不一样
 * - **搜索词不转小写**。老项目 setState 时就转,用户打大写会看到字母当场变小写
 * - `isDefault` 是**唯一的驼峰字段**,`userid` 是全小写连写 —— 都是后端定的,别顺手改
 */

export interface ProductProfile {
  /** 后端读 `_id`,写 `id`,新增响应 `data.id` */
  id: string;
  product_name: string;
  /** 列表叫「主营业务」、表单叫「产品简介」,同一个字段两套中文名。这里统一叫产品简介 */
  main_business: string;
  /** 列表叫「核心价值/优势」、表单叫「我们的独特点」。统一叫核心优势 */
  core_value_proposition: string;
  excluded_customer_types: string;
  other_message: string;
  /** **只读**:前端没有任何写入路径,推测是后端/AI 归纳出来的 */
  pain_points_solved: string;
  isDefault: boolean;
  /** 创建者 userid,全小写连写 */
  userid: string;
  create_time: number;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

const toRow = (r: Record<string, unknown>): ProductProfile => ({
  // 新增响应给的是 id,列表给的是 _id,两个都认
  id: str(r._id) || str(r.id),
  product_name: str(r.product_name),
  main_business: str(r.main_business),
  core_value_proposition: str(r.core_value_proposition),
  excluded_customer_types: str(r.excluded_customer_types),
  other_message: str(r.other_message),
  pain_points_solved: str(r.pain_points_solved),
  isDefault: r.isDefault === true,
  userid: str(r.userid),
  create_time: num(r.create_time),
});

export interface ProductQuery {
  current: number;
  pageSize: number;
  keyword: string;
  sort: Record<string, 1 | -1>;
}

export const DEFAULT_PRODUCT_SORT: Record<string, 1 | -1> = { create_time: -1 };

/**
 * 列表。老项目还会带一个恒为 `{}` 的 `filter` 参数,页面上根本没有对应控件,不带。
 * 响应的 `current` **不回写页码** —— 老项目回写了,而页码又是拉数据的依赖,
 * 服务端返回的 current 与请求不一致时会再触发一次请求。
 */
export const listProducts = (q: ProductQuery) =>
  postEnvelope<PageResult<Record<string, unknown>> | undefined>('/profile/product-list', {
    current: q.current,
    pageSize: q.pageSize,
    // 不转小写:大小写规则交给后端
    keyword: q.keyword.trim(),
    sort: q.sort,
  }).then((r) => ({
    list: (r?.list ?? []).map(toRow),
    total: num(r?.total),
  }));

/**
 * 选择器用的清单。老项目所有下拉都硬编码 `pageSize: 100` 且只在这 100 条里前端过滤 ——
 * 第 101 条产品在每一个评分入口都选不到,选中项不在前 100 条时输入框还会显示空。
 * 后端单页上限为 100，逐页取齐，不能发 500（会被校验拒绝或回退到 15 条）。
 */
export async function listProductOptions(keyword = '') {
  const rows: ProductProfile[] = [];
  for (let current = 1; ; current += 1) {
    const page = await listProducts({
      current,
      pageSize: 100,
      keyword,
      sort: DEFAULT_PRODUCT_SORT,
    });
    const existing = new Set(rows.map((row) => row.id));
    const added = page.list.filter((row) => !existing.has(row.id));
    rows.push(...added);
    if (!added.length || rows.length >= page.total) return rows;
  }
}

/* ---------- 编辑 ---------- */

export interface ProductDraft {
  /** 空 = 新建 */
  id: string;
  product_name: string;
  main_business: string;
  core_value_proposition: string;
  excluded_customer_types: string;
  other_message: string;
}

export const emptyProduct = (): ProductDraft => ({
  id: '',
  product_name: '',
  main_business: '',
  core_value_proposition: '',
  excluded_customer_types: '',
  other_message: '',
});

/** 回填一律经过这里补 `''` —— 老项目逐个 setValue 且不兜底,undefined 会把输入框从受控切成非受控 */
export const draftFromProduct = (p: ProductProfile): ProductDraft => ({
  id: p.id,
  product_name: p.product_name,
  main_business: p.main_business,
  core_value_proposition: p.core_value_proposition,
  excluded_customer_types: p.excluded_customer_types,
  other_message: p.other_message,
});

/** 五个文本字段统一 trim 后发出;未填的发空串,不让键消失 */
export function productBody(d: ProductDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    product_name: d.product_name.trim(),
    main_business: d.main_business.trim(),
    core_value_proposition: d.core_value_proposition.trim(),
    excluded_customer_types: d.excluded_customer_types.trim(),
    other_message: d.other_message.trim(),
  };
  if (d.id) body.id = d.id;
  return body;
}

/** 新增回新档案的 id —— 评分入口新建完要立刻选中它,这是在用的能力 */
export const addProduct = (d: ProductDraft) =>
  postEnvelope<Record<string, unknown> | undefined>('/profile/product-add', productBody(d)).then(
    (r) => str(r?.id) || str(r?._id),
  );

export const saveProduct = (d: ProductDraft) =>
  postEnvelope<unknown>('/profile/product-save', productBody(d));

export const deleteProduct = (id: string) =>
  postEnvelope<unknown>('/profile/product-delete', { id });

/** 单向「设为默认」,互斥由后端保证 —— 老项目没有取消入口 */
export const setDefaultProduct = (id: string) =>
  postEnvelope<unknown>('/profile/product-default', { id });

/* ---------- 校验 ---------- */

export const PRODUCT_TEXT_MAX = 512;

/** 五个字段的顺序即表单顺序;后四个带问号提示 */
export const PRODUCT_FIELDS = [
  'product_name',
  'main_business',
  'core_value_proposition',
  'excluded_customer_types',
  'other_message',
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];

export const REQUIRED_PRODUCT_FIELDS: ProductField[] = ['product_name', 'main_business'];

/** AI 匹配靠这五段文字,填得越全越准 —— 列表里用它提示还差几项 */
export const productFilled = (p: ProductProfile) =>
  PRODUCT_FIELDS.filter((k) => p[k].trim().length > 0);

export function validateProduct(d: ProductDraft) {
  const e: Partial<Record<ProductField, string>> = {};
  for (const k of PRODUCT_FIELDS) {
    const v = d[k].trim();
    // 老项目不 trim,一串空格就能通过必填
    if (!v && REQUIRED_PRODUCT_FIELDS.includes(k)) {
      e[k] = k === 'product_name' ? 'pp.errNameEmpty' : 'pp.errBusinessEmpty';
    } else if (v.length > PRODUCT_TEXT_MAX) {
      e[k] = 'pp.errTooLong';
    }
  }
  return e;
}
