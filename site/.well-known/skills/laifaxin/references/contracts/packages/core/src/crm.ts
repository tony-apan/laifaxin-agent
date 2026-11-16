import type { PageResult } from './pagination';
/**
 * 客户管理(联系人 / 公司 / 回收站)的契约。全部是 POST,包括读操作。
 *
 * 这个模块最容易静默出错的地方是**主键有五套口径**,参数名对了但值取错时
 * 接口会回 success:true 而什么都没做:
 * - 联系人:行主键 `_id`,业务主键 `cid`。正常联系人操作传 cid，回收站恢复传 _id
 * - 公司:  行主键 `_id`,单条接口的参数名却叫 `id`
 * - 任务:  行主键 `_id`,参数名叫 `id`(不是 taskId)
 * - 导入:  主键 `iid`,批量 `iids`
 * - 导出:  主键 `id`,批量 `ids`
 *
 * 其余几处口径坑:
 * - /contacts/contacts/show 的 viewId **永远发 'all'**,视图靠 filters 表达
 * - views-pin-save 的参数名是 `viewType`,不是 `type` —— 全项目独此一份
 * - 「未知」一律拼作 unkown(少个 n),verify_status 与 contactVerifyStatus 都是
 * - 批量写接口回的是 { backendId },要挂到后台任务总线上,否则用户以为点了没反应
 */

/* ---------- 视图 ---------- */

/** 视图类型 = 「哪张表的视图」。同一套接口靠它区分 */
export type ViewType =
  | 'contacts'
  | 'searchCompany'
  | 'companyDbSearch'
  | 'linkedinCompany'
  | 'saleTask'
  /** 插件云端 · 谷歌地图 */
  | 'extMap'
  /** 插件云端 · 谷歌搜索 */
  | 'extGoogleSearch';

export interface ViewItem {
  viewId?: string;
  name?: string;
  shared?: 'private' | 'team' | 'everyone';
  editable?: boolean;
  userid?: string;
}

export interface ViewGroups {
  systemViews?: ViewItem[];
  mineViews?: ViewItem[];
  othersViews?: ViewItem[];
}

export interface ViewConfig {
  viewId?: string;
  name?: string;
  editable?: boolean;
  logic?: Logic;
  filters?: FilterCondition[];
  keyword?: string;
}

/** 固定在标签栏上的视图上限 */
export const PINNED_VIEW_MAX = 6;

/** 「全部」这个内置视图的哨兵 id */
export const ALL_VIEW = 'all';

/* ---------- 字段字典 ---------- */

/** 字段的值类型,决定可用算子与输入控件 */
export type ValueType =
  | 'text'
  | 'textarea'
  | 'digit'
  | 'money'
  | 'percent'
  | 'select'
  | 'date'
  | 'dateTime'
  | 'boolean';

export interface FieldItem {
  /** 中文列名 */
  title?: string;
  /** 字段名。既是列的 key,也是筛选条件里的 property */
  dataIndex?: string;
  valueType?: ValueType;
  /** 值域。**只有「用户自建的 select 字段」才有** —— 后端的条件是
   *  `valueType === 'select' && setOptions === '1'` */
  options?: { label?: string; value?: string }[];
  /** 自定义选择字段是否允许多选，旧接口使用字符串 1/0。 */
  multi?: string | boolean;
  /**
   * 另一份值域。后端只给两个字段塞:`tags` 是标签表 `{ id, name, color }`,
   * `userid` 是成员表 `{ userid, nickname }` —— **两种形状,键名都不一样**,
   * 而且和 {@link options} 也不一样。统一取值走 {@link fieldChoices}。
   */
  items?: Record<string, unknown>[];
  editable?: boolean;
  width?: number;
  /** 能不能出现在导入的字段映射里。缺省按「能」处理 */
  importAble?: boolean;
}

/**
 * 列字段。saveType 是个矩阵维度:
 * show=列表要展示的、read=全部可选的、create=新建表单的、update=详情可改的、modify=批量修改的
 */
export type FieldScope = 'show' | 'read' | 'create' | 'update' | 'modify';

/** 客户列表用视图类型,字段接口用字段归属名,两者并不是一套枚举。 */
export function fieldListBelongTo(viewType: ViewType) {
  if (viewType === 'searchCompany') return 'company';
  if (viewType === 'companyDbSearch') return 'dbSearchCompany';
  return viewType;
}

export type ColumnWidthSettings = Record<string, { width?: number }>;

/* ---------- 筛选 DSL ---------- */

export type Logic = 'and' | 'or';

export interface FilterCondition {
  property: string;
  operator: string;
  /** 多值算子用 values,单值算子用 value。哪个算多值见 {@link valueArity} */
  values?: string[];
  value?: string | number;
  valueType?: ValueType;
}

/**
 * 按值类型给出可用算子。
 *
 * ⚠️ **取值以后端 `service/fields.ts` 的 `exFieldFilterToQuery` 为准**,不是
 * 凭语感起的名。后端是一长串 `if (operator === 'xxx')`,**认不出的算子直接
 * `return null`,那条条件被静默丢掉** —— 不报错、不提示,只是筛选结果变宽。
 * 所以这张表错一个词,用户就会看到「我明明加了条件,数量却没变」。
 *
 * 几个反直觉的词,都核对过后端:
 * - 「为空」是 `null`,不是 `isNull`
 * - 「不包含」是 `exclude`,不是 `notInclude`
 * - 「开头是」是 `beginWith`,不是 `startWith`
 * - 「正则」是 `regexp`,不是 `regex`
 * - 「不等于」是 `neq`,不是 `notEq`
 * - 日期的 `before`/`after` **收的是天数不是日期**,见 {@link valueInput}
 */
const TEXT_OPERATORS = [
  'include',
  'exclude',
  'eq',
  'neq',
  'beginWith',
  'beginNotWith',
  'endWith',
  'endNotWith',
  'regexp',
  'notNull',
  'null',
];

const NUMBER_OPERATORS = ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'notNull', 'null'];

const DATE_OPERATORS = ['lt', 'gt', 'before', 'after', 'eq', 'neq', 'notNull', 'null'];

export const OPERATORS: Record<string, string[]> = {
  text: TEXT_OPERATORS,
  textarea: TEXT_OPERATORS,
  digit: NUMBER_OPERATORS,
  money: NUMBER_OPERATORS,
  percent: NUMBER_OPERATORS,
  select: ['include', 'exclude', 'all', 'eq', 'notNull', 'null'],
  date: DATE_OPERATORS,
  dateTime: DATE_OPERATORS,
  // 后端没有 boolean 分支,只有末尾那个 null/notNull 兜底能命中。
  // 给它列出 eq 等于给用户一个按了没反应的选项
  boolean: ['notNull', 'null'],
};

/**
 * ES 后端(领英库)的算子表。**和上面那套只有一半重合** ——
 * 没有 eq/gte/before,数值只有 `range`,「不为空」两边都叫 notNull 但
 * 「同时包含」这边叫 `all`、那边(select)也叫 `all`,文本那边却没有。
 * 拿 Mongo 那套算子发给 ES 接口不会报错,只会静默返回不对的结果。
 */
export const ES_OPERATORS: Record<string, string[]> = {
  text: ['include', 'all', 'exclude', 'notNull', 'null'],
  textarea: ['include', 'all', 'exclude', 'notNull', 'null'],
  select: ['include', 'exclude', 'notNull', 'null'],
  boolean: ['notNull', 'null'],
  digit: ['range', 'notNull', 'null'],
};

/**
 * 这张表走 ES 检索,筛选条件要用 ES 算子。
 * 只列**核实过**的那一个 —— 其余表(客户管理、AI 数据库)现网走的是上面那套,
 * 没核实就顺手加进来会把已经能用的页面改坏。
 */
export const esView = (type: ViewType) => type === 'linkedinCompany';

/** 不需要填值的算子。UI 要据此把值输入框收起来 */
export const VALUELESS_OPERATORS = new Set(['notNull', 'null']);

/** 收「下界 + 上界」两个数的算子。ES 的数值字段只有它 */
export const RANGE_OPERATOR = 'range';

/**
 * 收多个值的算子。
 *
 * ⚠️ 这张表**不足以判断元数**,还要看值类型:`eq` 在文本/数值/日期下读 `value`,
 * 在 select 下读的却是 `values`(后端 `return { [property]: values }`)。
 * 判断一律走 {@link valueArity},别直接查这个集合。
 */
export const MULTI_VALUE_OPERATORS = new Set([
  'include',
  'exclude',
  'beginWith',
  'beginNotWith',
  'endWith',
  'endNotWith',
  'regexp',
  'all',
]);

export const operatorsFor = (
  valueType: ValueType | undefined,
  type?: ViewType,
  property?: string,
) => {
  // 旧版公司库的邮箱数量是预设区间多选，只支持包含/排除，不能套用通用 select 算子。
  if (type === 'companyDbSearch' && property === 'email_size') return ['include', 'exclude'];
  const table = type && esView(type) ? ES_OPERATORS : OPERATORS;
  return table[valueType ?? 'text'] ?? table.text;
};

/** 一条条件要填几个值 */
export type ValueArity = 'none' | 'single' | 'multi' | 'range';

export function valueArity(operator: string, valueType?: ValueType): ValueArity {
  if (VALUELESS_OPERATORS.has(operator)) return 'none';
  if (operator === RANGE_OPERATOR) return 'range';
  // select 下**四个带值的算子(include/exclude/all/eq)后端读的都是 values**
  if (valueType === 'select') return 'multi';
  return MULTI_VALUE_OPERATORS.has(operator) ? 'multi' : 'single';
}

/**
 * 该给这条条件配哪种输入控件。这是「值类型 × 算子」的函数,不是值类型的函数 ——
 * 同一个日期字段,`lt` 要日历,`before` 要的却是一个天数。
 *
 * - `none`    不填值
 * - `range`   两个数(ES 数值)
 * - `options` 值域下拉(select:标签、成员、自定义选项)
 * - `days`    天数。日期字段的 `before`/`after` 后端是
 *             `moment().subtract(value, 'days')` —— 传日期进去会算出 1970 年
 * - `date`    日历,发毫秒时间戳
 * - `number`  数值
 * - `tokens`  多个关键词
 * - `text`    单个文本
 */
export type ValueInput =
  | 'none'
  | 'range'
  | 'options'
  | 'days'
  | 'date'
  | 'number'
  | 'tokens'
  | 'text';

export function valueInput(operator: string, valueType?: ValueType): ValueInput {
  const arity = valueArity(operator, valueType);
  if (arity === 'none') return 'none';
  if (arity === 'range') return 'range';
  if (valueType === 'select') return 'options';
  if (valueType === 'date' || valueType === 'dateTime') {
    return operator === 'before' || operator === 'after' ? 'days' : 'date';
  }
  if (valueType === 'digit' || valueType === 'money' || valueType === 'percent') return 'number';
  return arity === 'multi' ? 'tokens' : 'text';
}

/**
 * 算子文案的分组。**同一个词在不同值类型下读法不一样**:`lt` 在数值是「小于」、
 * 在日期是「早于」;`eq` 在文本是「是」、在数值是「等于」、在日期是「是这一天」。
 * 用一张扁平的算子文案表会逼出「小于/早于」这种两头不讨好的标签。
 */
export const opLabelGroup = (valueType?: ValueType) => {
  if (valueType === 'digit' || valueType === 'money' || valueType === 'percent') return 'opsNum';
  if (valueType === 'date' || valueType === 'dateTime') return 'opsDate';
  if (valueType === 'select') return 'opsSelect';
  return 'ops';
};

/**
 * 字段的候选值。后端把它拆在**两个形状不同的键**里:
 * - `options`:用户自建的 select 字段,`{ label, value }`
 * - `items`:只有 `tags`(标签表)和 `userid`(成员表)有,一个是
 *   `{ id, name, color }`、另一个是 `{ userid, nickname }`
 *
 * 老项目的做法是按 property 名写死一串 if(tags 用标签选择器、userid 用成员
 * 选择器、countryCode 用国家选择器……),字段一多就漏。这里只认形状。
 */
export interface FieldChoice {
  value: string;
  label: string;
  color?: string;
}

export function fieldChoices(field: FieldItem | undefined): FieldChoice[] {
  const opts = (field?.options ?? [])
    .map((o) => ({ value: o.value ?? '', label: o.label ?? o.value ?? '' }))
    .filter((o) => o.value);
  if (opts.length) return opts;
  return (
    (field?.items ?? [])
      // ⚠️ 标签表里**目录也是一行**(`folder: true`),后端 getTagsItems 没把它们
      // 排掉。目录不是标签,选中它筛出来永远是 0 条 —— 得在这一层挡住
      .filter((it) => (it as Record<string, unknown>).folder !== true)
      .map((it) => {
        const r = it as Record<string, unknown>;
        const value =
          typeof r.id === 'string' ? r.id : typeof r.userid === 'string' ? r.userid : '';
        const label =
          typeof r.name === 'string' ? r.name : typeof r.nickname === 'string' ? r.nickname : value;
        return { value, label, color: typeof r.color === 'string' ? r.color : undefined };
      })
      .filter((o) => o.value)
  );
}

/** 条件是否已填完整。没填值的条件发出去会被后端当成「匹配空值」 */
export function isFilterComplete(f: FilterCondition): boolean {
  if (!f.property || !f.operator) return false;
  const arity = valueArity(f.operator, f.valueType);
  if (arity === 'none') return true;
  // 范围要两头都有 —— 只填一头后端会当成「和空值比大小」,结果恒空
  if (arity === 'range') {
    const [lo, hi] = f.values ?? [];
    return lo !== undefined && lo !== '' && hi !== undefined && hi !== '';
  }
  if (arity === 'multi') return (f.values?.length ?? 0) > 0;
  return f.value !== undefined && f.value !== '';
}

/**
 * 值的线上形态。**数值字段必须发数字**:后端拼的是 `{ $gte: value }`,
 * Mongo 里字符串和数字不同类型、比较恒不命中。后端虽然同时 or 了一个
 * `` `${value}` ``,但那一支只救得了「存成字符串的数字」,救不了发字符串的前端。
 *
 * 日期发毫秒时间戳(与老项目的 DatePicker 一致),`before`/`after` 发天数。
 */
function wireValue(v: string | number | undefined, valueType?: ValueType) {
  if (v === undefined || v === '') return '';
  if (
    valueType === 'digit' ||
    valueType === 'money' ||
    valueType === 'percent' ||
    valueType === 'date' ||
    valueType === 'dateTime'
  ) {
    const n = Number(v);
    return Number.isFinite(n) ? n : '';
  }
  return v;
}

/**
 * 一条条件里能发给后端的键就这 5 个。前端给条件挂的行内状态(本地 id、错误文案)
 * 必须在提交前剥掉 —— 旧项目的「导入条件」那条路径漏了这一步,把随机 id 发给了后端。
 * `valueType` 由字段表回填,不由用户选。
 */
export function wireFilter(f: FilterCondition, fields?: FieldItem[]): FilterCondition {
  const known = fields?.find((x) => x.dataIndex === f.property);
  const valueType = known?.valueType ?? f.valueType;
  const arity = valueArity(f.operator, valueType);
  return {
    property: f.property,
    operator: f.operator,
    // 元数不对的那一半清掉:select 的 eq 只读 values,发个残留的 value 过去
    // 不会报错,但会让人以为条件生效了
    value: arity === 'single' ? wireValue(f.value, valueType) : '',
    values: arity === 'multi' || arity === 'range' ? (f.values ?? []) : [],
    valueType,
  };
}

export type TagAction = 'add' | 'replace' | 'del';

/* ---------- 批量操作的通用信封 ---------- */

/** 勾选口径:只作用当前页 / 前 N 条 / 整套筛选命中的全部 */
export type SelectOption = 'current' | 'front' | 'all';

/**
 * 批量接口的通用参数。selectOption 决定后端按什么作用:
 * current 用 selectKeys,front 用 filters 取前 selectTotal 条,all 用 filters 全量。
 * 所以 selectKeys.length 与 selectTotal **可以不相等**,不能拿前者当选中数。
 */
export interface BaseParams {
  /** postEnvelope 要求可索引 */
  [k: string]: unknown;
  selectAll: boolean;
  selectKeys: string[];
  selectSort: Record<string, 1 | -1>;
  selectTotal: number;
  selectOption: SelectOption;
  filters: FilterCondition[];
  keyword: string;
  logic: Logic;
  sort: Record<string, 1 | -1>;
}

/**
 * 加入 / 移出黑名单的请求体。**六七个业务面各有各的端点,但请求体是同一套** ——
 * 差别只在多带一个 id(联系人无、公司无、企业库 refineTaskId、评分结果 taskId)。
 * 所以只有这一个类型和一个弹窗,不要按端点各写一套。
 *
 * 两个必须记住的口径:
 * - 动作值是 `'add' | 'delete'`,**没有 `'cancel'`**。旧项目组件层混用过 'cancel',
 *   而后端只认 delete —— 传错时后端按默认走「加入」,用户点的是「移出」。
 * - 移出时 `blackTypes` / `blackComment` 都发空:黑名单没有「只移出发送、保留提取」
 *   这种半移出语义,发一半反而会让后端按残留值理解。
 */
export interface BlackParams extends Omit<BaseParams, 'selectAll'> {
  blackAction: 'add' | 'delete';
  blackTypes: ('search' | 'send')[];
  blackComment: string;
}

/** 「前 N 条」的上限与默认值,照旧项目的口径 */
export const FRONT_MAX = 10_000;

export const FRONT_DEFAULT = 200;

/** 打开「前 N 条」时给的初值 */
export const defaultFrontCount = (total: number) => Math.min(total, FRONT_DEFAULT);

/**
 * 把用户输入的 N 夹到能用的范围里:不超过总数与硬上限,也不少于 `least`
 * (通常是已经勾中的条数 —— 比它还小的「前 N 条」没有意义)。
 */
export function clampFrontCount(raw: number, least: number, total: number) {
  const safe = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  const upper = Math.min(FRONT_MAX, total);
  return Math.max(Math.min(safe, upper), Math.min(Math.max(least, 1), total));
}

export interface SelectionState {
  /** 正常联系人列表使用 cid；公司及回收站使用记录 _id。 */
  keys: string[];
  option: SelectOption;
  total: number;
}

export function baseParams(
  selection: SelectionState,
  query: {
    filters: FilterCondition[];
    keyword: string;
    logic: Logic;
    sort: Record<string, 1 | -1>;
  },
): BaseParams {
  return {
    selectAll: false,
    selectKeys: selection.keys,
    selectSort: query.sort,
    selectTotal: selection.total,
    selectOption: selection.option,
    filters: query.filters,
    keyword: query.keyword,
    logic: query.logic,
    sort: query.sort,
  };
}

/* ---------- 联系人 ---------- */

/** 邮箱验证结果。unkown 少个 n,是后端口径 */
export type VerifyStatus = 'valid' | 'invalid' | 'unkown' | 'full' | 'waiting' | '';

export interface ContactRow {
  /** 行主键，回收站恢复接口使用它。 */
  _id?: string;
  /** 业务主键，正常联系人单条与批量接口使用它。 */
  cid?: string;
  /** 关联公司的主键 */
  c_id?: string;
  c_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  domain?: string;
  verify_status?: VerifyStatus;
  tags?: string[];
  source?: string;
  position?: string;
  department?: string;
  remark?: string;
  userid?: string;
  /** 为真时整行加删除线并变灰 */
  isBlack?: boolean;
  sequences?: string[];
  devCount?: number;
  readCount?: number;
  replyCount?: number;
  create_time?: number;
  update_time?: number;
  [k: string]: unknown;
}

export interface ListQuery {
  keyword: string;
  filters: FilterCondition[];
  logic: Logic;
  current: number;
  pageSize: number;
  sort: Record<string, 1 | -1>;
  [k: string]: unknown;
}

/** 命中数是精确值还是下限。gte 时页脚要说「大于 N 条」 */
export interface ListResult<T> extends PageResult<T> {
  relation?: 'eq' | 'gte';
}

/**
 * 表格勾选的是行的 _id,批量接口要的是 cid —— 这一步漏了的话,
 * 接口会拿着一批不存在的 id 回 success:true,什么都没做。
 */
export function toCids(rows: ContactRow[], selectedIds: string[]): string[] {
  const byId = new Map(rows.map((r) => [r._id ?? '', r.cid ?? '']));
  return selectedIds.map((id) => byId.get(id) ?? '').filter(Boolean);
}

/* ---------- 公司 ---------- */

export interface CompanyRow {
  /** 行主键。单条接口的参数名却叫 id */
  _id?: string;
  name?: string;
  domain?: string;
  country_code?: string;
  tags?: string[];
  contactCount?: number;
  isBlack?: boolean;
  userid?: string;
  create_time?: number;
  [k: string]: unknown;
}

/* ---------- 回收站 ---------- */

export interface RecycleQuery extends ListQuery {
  /** 删除时间的筛选值不是时间戳,是关键字或 YYYY-MM-DD */
  deleteTime?: string;
}

/* ---------- 保存联系人(解锁 AI 数据库与领英那颗降级按钮) ---------- */

/** 每家公司最多保存几个联系人的档位 */
export const SAVE_MAX_COUNTS = [1, 3, 5, 10, 20, 50, 100, 200, 500, 1000] as const;

/** 单价:有效邮箱 2 点/个,未知 1 点/个。两个都勾时按 2 计 */
export const COST_VALID = 2;

export const COST_UNKOWN = 1;

export interface SaveContactsForm {
  [k: string]: unknown;
  companySave: true;
  companyTags: string[];
  companyOption: TagAction | 'nothing';
  contactSave: true;
  contactTags: string[];
  contactOption: TagAction | 'nothing';
  /** 拼写就是 unkown */
  contactVerifyStatus: ('valid' | 'unkown')[];
  contactMaxCount: number;
  contactPositions: string[];
  contactExcludes: string[];
}

/** 检索条件侧的九个字段,由调用方(AI 数据库 / 领英)提供 */
export interface SaveContactsContext {
  [k: string]: unknown;
  /** 评分来源是**域名**数组;AI 数据库与领英是公司 id */
  selectKeys: string[];
  selectOption: SelectOption;
  selectTotal: number;
  selectSort: Record<string, 1 | -1>;
  filters: unknown[];
  filter: Record<string, unknown>;
  keyword: string;
  logic: Logic;
  refineTaskId?: string;
  /** 评分结果页用它 */
  taskId?: string;
}

/**
 * 预估上限 = 家数 × 每家上限 × 单价。
 * 是**上限**不是实际:去重后不重复扣点,实际通常远低于这个数 —— 文案要说清楚,
 * 否则用户看到一个吓人的数字就不敢点了。
 */
export function estimateCost(form: SaveContactsForm, companies: number): number {
  // 一种都不勾等于什么都不存,单价是 0 —— 原来会退化成「未知邮箱」的 1 点,
  // 界面上显示一个根本不会发生的消耗
  if (form.contactVerifyStatus.length === 0) return 0;
  const unit = form.contactVerifyStatus.includes('valid') ? COST_VALID : COST_UNKOWN;
  return companies * form.contactMaxCount * unit;
}

/** 三个入口同一个表单,只换端点 */
export type SaveContactsSource = 'refine' | 'linkedin' | 'rating' | 'domain';

export const SAVE_ENDPOINT: Record<SaveContactsSource, string> = {
  domain: '/clues/domain-save-create',
  refine: '/refine/company-save',
  linkedin: '/search/linkedin-company-v2-save',
  // 评分结果页的保存走 clues 命名空间,上下文是 taskId + scoreLevels 而不是检索条件
  rating: '/clues/rating-result-save-contacts',
};

/**
 * 邮箱验证的计费试算。照旧项目 email-verify-dialog 的口径:
 * **免费额度够覆盖整批 → 0 点;不够 → 按整批算 floor(总数 / 10)**。
 * 不是「按超出免费额度的部分算」—— 100 条剩 99 个免费额度时,
 * 前者 10 点、后者 0 点,差着一个数量级。
 */
export function verifyCost(count: number, freeLeft: number): number {
  return freeLeft >= count ? 0 : Math.floor(count / 10);
}
export type { TagItem, TagType } from './tags';
