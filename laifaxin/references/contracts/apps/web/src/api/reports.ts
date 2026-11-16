import { postEnvelope } from '@/api/auth';

/**
 * 「数据」组(数据总览 + 数据分析)的契约。六个接口零交集,两页不共用任何数据源。
 *
 * **本组最反直觉的一件事:`percent` 和 `chartData` 不看你传的日期区间。**
 * 后端 `getOverviewCardDataByDate` 里两个窗口是写死的:
 * - `total` 吃 `beginDate` / `endDate`(用户选的区间)
 * - `percent` 恒是 `[D-7, D-1]` 对比 `[D-14, D-8]`
 * - `chartData` 恒是 `[D-7, D-1]` 这七天
 * 所以「过去 7 天」这个角标对涨跌和迷你折线是准的,对大数字是错的 ——
 * 界面上必须把这两件事分开说,不能贴一个含糊的角标了事。
 *
 * 其余几处口径:
 * - 日期全链路是 `'YYYY-MM-DD'` 字符串,没有毫秒数、没有 ISO 串
 * - 按天序列**稀疏,不补零**:某天没有数据就整条记录缺失,不是 `count: 0`。
 *   画图前必须按 `date` 对齐补零,**不能按数组下标对齐**
 * - `member-table-data` 的 data 是**裸数组**,没有分页、`total` 也不在兄弟位
 * - 成员行的 `_id` 装的是 **userid**,这一层就归一掉,别把这个名字带进业务代码
 * - `percent` 是 `number | null`:null 表示「上期为 0、本期有量」,没有同比基数
 */

/** 查询对象。`queryId` 一个参数名承载两套主键,取错值域接口会回 success:true 且全零 */
export type QueryObject = 'user' | 'team';

export interface ReportsQuery {
  /** postEnvelope 要求可索引 */
  [k: string]: unknown;
  queryObject: QueryObject;
  /** queryObject 为 user 时是 **userid**;为 team 时是 **team_id**(蛇形,不是 teamId) */
  queryId: string;
  /** 'YYYY-MM-DD' */
  beginDate: string;
  /** 'YYYY-MM-DD' */
  endDate: string;
}

/**
 * 14 个指标 key。这是全站唯一权威表,与后端 `common/data.ts` 一一对应。
 * ⚠️ 中文名**不唯一**(「任务数量」「消耗点数」各出现两次),永远不能拿中文当 key。
 */
export const METRIC_KEYS = [
  'CustomerCreateCount',
  'CustomerDeleteCount',
  'CustomerExportCount',
  'CreditCountGet',
  'CreditCountCost',
  'SearchTasksCount',
  'SearchCountCost',
  'SearchEmailCount',
  'MassTasksCount',
  'MassEmailCount',
  'MassReadCount',
  'EmailNewCount',
  'EmailReplyCount',
  'EmailOtherCount',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** 按天的一个点。**序列是稀疏的**,缺的那天不会出现 */
export interface DayPoint {
  date: string;
  count: number;
}

export interface MetricCard {
  type: string;
  total: number;
  /**
   * 涨跌百分数,单位已经是「百分点」(后端给 12.5 就是 12.5%)。
   * **null 表示上期为 0**(从 0 起量),没有同比基数 —— 不是 0,更不是「上涨」。
   */
  percent: number | null;
  /** 固定的最近七天,与筛选区间无关 */
  chartData: DayPoint[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** percent 要保住 null:它和 0 是两种含义,合并了界面就没法区分「持平」和「无基数」 */
const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const days = (v: unknown): DayPoint[] =>
  Array.isArray(v)
    ? v.map((d) => ({
        date: String((d as DayPoint)?.date ?? ''),
        count: num((d as DayPoint)?.count),
      }))
    : [];

/**
 * 指标卡。四张卡打的是**同一个接口**,只有 type 不同,所以一次筛选变化会并发四次。
 * 不能改调 `analytics-cards-data` 合并 —— 那个接口不返回 chartData。
 *
 * 兜底放在这一层而不是渲染处:后端少给一个数组字段时,旧项目是整包覆盖 state,
 * 渲染时 `.map` 到 undefined 直接把整个 App 顶掉。
 */
export const getOverviewCard = (q: ReportsQuery & { type: MetricKey }) =>
  postEnvelope<Partial<MetricCard> | undefined>('/reports/overview-card-data', q).then(
    (d): MetricCard => ({
      type: q.type,
      total: num(d?.total),
      percent: pct(d?.percent),
      chartData: days(d?.chartData),
    }),
  );

/** 分析页的卡片组。**注意请求键是复数 `types` 数组**,响应是以 type 为键的字典 */
export const getAnalyticsCards = (q: ReportsQuery & { types: MetricKey[] }) =>
  postEnvelope<Record<string, Partial<MetricCard>> | undefined>(
    '/reports/analytics-cards-data',
    q,
  ).then((d) =>
    Object.fromEntries(
      q.types.map((k) => [k, { total: num(d?.[k]?.total), percent: pct(d?.[k]?.percent) }]),
    ),
  );

/** 单指标按天序列。**这个吃用户选的区间**(与 overview-card 的 chartData 不同) */
export const getMetricSeries = (q: ReportsQuery & { type: MetricKey }) =>
  postEnvelope<DayPoint[] | undefined>('/reports/object-chart-data', q).then(days);

export interface MailTotals {
  replyMailTotal: number;
  otherMailTotal: number;
}

/**
 * 新邮件构成。响应里还有个 `newMailTotal`,埋点上恒等于另外两者之和,
 * 旧页面取回来一次都没读过 —— 这里直接不要它,免得出现「中心数与两片之和对不上」。
 */
export const getMailTotals = (q: ReportsQuery) =>
  postEnvelope<Partial<MailTotals> | undefined>('/reports/new-mail-total-data', q).then(
    (d): MailTotals => ({
      replyMailTotal: num(d?.replyMailTotal),
      otherMailTotal: num(d?.otherMailTotal),
    }),
  );

export interface CreditHistory {
  getHistory: DayPoint[];
  costHistory: DayPoint[];
}

export const getCreditHistory = (q: ReportsQuery) =>
  postEnvelope<Partial<CreditHistory> | undefined>('/reports/count-history-data', q).then(
    (d): CreditHistory => ({ getHistory: days(d?.getHistory), costHistory: days(d?.costHistory) }),
  );

/** 成员一行。14 个指标各一列 */
export type MemberRow = { userid: string } & Record<MetricKey, number>;

/**
 * 成员数据。**响应里没有 nickname**,名字要自己拿 userid 去成员列表里 join;
 * 而且**零活跃的成员整行不出现**(后端的补零只在结果整体为空时才触发),
 * 所以团队人数会对不上 —— 用成员名单做左连接补齐,见 `mergeMembers`。
 */
export const getMemberTable = (q: ReportsQuery) =>
  postEnvelope<Record<string, unknown>[] | undefined>('/reports/member-table-data', q).then(
    (rows): MemberRow[] =>
      (rows ?? []).map((r) => {
        // 后端把 userid 装在 _id 里。参数名对、值取错是这一族接口的高发点,
        // 所以在这一层就改回 userid,不把 _id 这个名字带出去
        const row = { userid: String(r._id ?? '') } as MemberRow;
        for (const k of METRIC_KEYS) row[k] = num(r[k]);
        return row;
      }),
  );

/**
 * 把「有数据的行」和「成员名单」合起来:名单在前(零活跃的补一行全 0),
 * 名单里没有、但确实有数据的行**追加在后面**。
 *
 * 后者不能丢:名单来自 subordinate-users,它和这个团队的成员范围未必完全重合
 * (调岗、离职、跨团队协作都会错开)。少显示一个空行只是不完整,
 * 把一行**有数据的**记录悄悄抹掉,比原来的问题更糟。
 */
export function mergeMembers(
  rows: MemberRow[],
  members: { userid: string }[] | undefined,
): MemberRow[] {
  if (!members?.length) return rows;
  const byId = new Map(rows.map((r) => [r.userid, r]));
  const known = new Set(members.map((m) => m.userid));
  const filled = members.map((m) => {
    const hit = byId.get(m.userid);
    if (hit) return hit;
    const blank = { userid: m.userid } as MemberRow;
    for (const k of METRIC_KEYS) blank[k] = 0;
    return blank;
  });
  return [...filled, ...rows.filter((r) => !known.has(r.userid))];
}

/**
 * 把稀疏的按天序列补成连续的。**必须按 date 对齐,不能按数组下标** ——
 * 旧项目的「通用点数」柱图 x 轴只取 getHistory 的日期、消耗按下标硬对齐,
 * 两条序列哪天不一样长就会静默错位。
 */
export function alignDays(...series: DayPoint[][]): { date: string; counts: number[] }[] {
  const dates = [...new Set(series.flatMap((s) => s.map((p) => p.date)))].sort();
  const maps = series.map((s) => new Map(s.map((p) => [p.date, p.count])));
  return dates.map((date) => ({ date, counts: maps.map((m) => m.get(date) ?? 0) }));
}

/** 涨跌的三态。null=没有同比基数,0=持平,正负=涨跌 */
export type Trend = 'none' | 'flat' | 'up' | 'down';
export const trendOf = (percent: number | null): Trend =>
  percent === null ? 'none' : percent === 0 ? 'flat' : percent > 0 ? 'up' : 'down';
