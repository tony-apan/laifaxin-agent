/**
 * 费用中心契约。路径与字段照搬 laifaxin-web,几处口径坑原样保留并加注:
 * - 消费明细里的 total、count 是**点数不是钱**,不能除 100、不能加 ¥
 * - 订单的 total 才是钱,单位是**分**
 * - 时间选择器的「昨天」后端值拼作 yestoday(少个 r),不是笔误,别顺手改
 */

/* ---------- 通用分页信封 ---------- */

export interface PageQuery {
  /** 1 起 */
  current: number;
  pageSize: number;
  filter?: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  /** postEnvelope 要求可索引;分页参数本身不会有额外键 */
  [k: string]: unknown;
}

/**
 * 真实后端的分页信封是 { current, list, total } —— 字段叫 **list 不是 data**。
 * 旧项目订单和消费明细都这么读(orders/index.tsx:56、billing/index.tsx:48)。
 * 写成 data 的话两张表接真后端会稳定空表,而 total 因为名字恰好一致仍显示正确总数,
 * 表现为「共 17 条却一行没有」—— mock 若照错的形状写就完全看不出来。
 */
export interface PageResult<T> {
  current?: number;
  total?: number;
  list?: T[];
}
