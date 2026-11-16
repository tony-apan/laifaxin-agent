/**
 * 设置 · 客户字段。联系人字段与公司字段在**同一张表**里,靠 `belongTo` 区分。
 *
 * 与老项目的差异:
 * - **`multi` 对外是布尔**。后端存的是字符串 `'0'/'1'`,在这一层来回换;
 *   老项目直接把字符串带进业务代码,一旦有人写 `if (multi)` 就永远为真。
 * - **备选项改名不改值**。老项目的选项永远 `label === value`,用户把「意向客户」
 *   改成「高意向客户」,所有存了旧值的记录当场变成孤儿。这里编辑已有选项时
 *   保留原 `value`,只改 `label`;新增的选项才 `value = label`。
 * - **非 select 不提交 `options` / `multi`**。老项目无条件带上,非 select 字段
 *   也会存一个 `[{label:'',value:''}]`。
 * - **能不能改删按 `source` / `setOptions` 判**,不再硬编码 `dataIndex === 'source'`。
 */

/** 归属实体。后端这一族接口用单数(field-list 那族用复数,不要混) */
export type FieldOwner = 'contact' | 'company';

export const FIELD_OWNERS = ['contact', 'company'] as const;

/** 下拉顺序即此顺序 */
export const VALUE_TYPES = [
  'text',
  'textarea',
  'digit',
  'percent',
  'date',
  'dateTime',
  'select',
] as const;

export type ValueType = (typeof VALUE_TYPES)[number];

export const isValueType = (v: unknown): v is ValueType =>
  typeof v === 'string' && (VALUE_TYPES as readonly string[]).includes(v);

/** 只有选项类字段才有「是否多选」与「备选项」 */
export const hasOptions = (v: ValueType) => v === 'select';

export interface FieldOptionItem {
  label: string;
  /** 落库值。改 label 时**不动它**,否则历史记录会变成孤儿 */
  value: string;
}

export interface FieldRow {
  belongTo: FieldOwner;
  /** 机器 key。与 belongTo 一起构成事实主键,后端不给别的 id */
  dataIndex: string;
  title: string;
  valueType: ValueType;
  multi: boolean;
  options: FieldOptionItem[];
  /** system = 来发信内置 */
  source: 'system' | 'custom';
  /** 后门:内置的选项类字段带上它就允许改备选项 */
  setOptions: boolean;
  create_time: number;
}

/** 行主键。后端没有可用的单字段主键,`fid` 存在但所有写操作都不带它 */
export const fieldKey = (f: { belongTo: string; dataIndex: string }) =>
  `${f.belongTo}:${f.dataIndex}`;

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

/** 后端的 `'0'` / `'1'`,也容忍真布尔 */
const flag = (v: unknown) => v === true || v === '1' || v === 1;

const toFlag = (v: boolean) => (v ? '1' : '0');

const toOptions = (v: unknown): FieldOptionItem[] =>
  Array.isArray(v)
    ? v
        .map((o) => {
          const r = (o ?? {}) as Record<string, unknown>;
          const value = str(r.value);
          const label = str(r.label) || value;
          return { label, value: value || label };
        })
        .filter((o) => o.label || o.value)
    : [];

export const toRow = (r: Record<string, unknown>): FieldRow => ({
  belongTo: r.belongTo === 'company' ? 'company' : 'contact',
  dataIndex: str(r.dataIndex),
  title: str(r.title),
  valueType: isValueType(r.valueType) ? r.valueType : 'text',
  multi: flag(r.multi),
  options: toOptions(r.options),
  source: r.source === 'system' ? 'system' : 'custom',
  setOptions: flag(r.setOptions),
  create_time: num(r.create_time),
});

/* ---------- 编辑 ---------- */

export interface FieldDraft {
  /** 空 = 新建 */
  dataIndex: string;
  belongTo: FieldOwner;
  title: string;
  valueType: ValueType;
  multi: boolean;
  options: FieldOptionItem[];
  source: 'system' | 'custom';
}

export const emptyField = (belongTo: FieldOwner = 'contact'): FieldDraft => ({
  dataIndex: '',
  belongTo,
  title: '',
  valueType: 'text',
  multi: false,
  options: [],
  source: 'custom',
});

export const draftFromField = (f: FieldRow): FieldDraft => ({
  dataIndex: f.dataIndex,
  belongTo: f.belongTo,
  title: f.title,
  valueType: f.valueType,
  multi: f.multi,
  options: f.options.map((o) => ({ ...o })),
  source: f.source,
});

/** 归属与类型创建后不可改,编辑时干脆不下发 —— 后端也不该信任前端传来的这两个 */
export function fieldBody(d: FieldDraft): Record<string, unknown> {
  const body: Record<string, unknown> = { title: d.title.trim() };
  if (hasOptions(d.valueType)) {
    body.multi = toFlag(d.multi);
    body.options = d.options.map((o) => ({ label: o.label.trim(), value: o.value }));
  }
  if (d.dataIndex) {
    body.dataIndex = d.dataIndex;
    body.belongTo = d.belongTo;
  } else {
    body.belongTo = d.belongTo;
    body.valueType = d.valueType;
  }
  return body;
}

/* ---------- 权限与校验 ---------- */

/**
 * 能不能改。自建的随便改;内置的只有「选项类 + 开了 setOptions」才让改备选项。
 * 老项目的删除按钮额外硬编码了 `dataIndex === 'source'` 一个特例,不复现。
 */
export const canEditField = (f: FieldRow) =>
  f.source === 'custom' || (f.valueType === 'select' && f.setOptions);

/** 内置字段只让改备选项,连名字都不许动 */
export const canDeleteField = (f: FieldRow) => f.source === 'custom';

export const FIELD_TITLE_MAX = 32;

export function validateField(d: FieldDraft) {
  const e: { title?: string; options?: string } = {};
  const title = d.title.trim();
  if (!title) e.title = 'fd.errTitleEmpty';
  else if (title.length > FIELD_TITLE_MAX) e.title = 'fd.errTitleLong';
  if (hasOptions(d.valueType)) {
    const vals = d.options.map((o) => o.label.trim()).filter(Boolean);
    // 老项目对备选项一条校验都没有:空串、纯空格、重复值全部放行
    if (vals.length === 0) e.options = 'fd.errOptionsEmpty';
    else if (vals.length !== d.options.length) e.options = 'fd.errOptionBlank';
    else if (new Set(vals).size !== vals.length) e.options = 'fd.errOptionDup';
  }
  return e;
}

/** 同一 belongTo 下字段名不能重复 —— 老项目没有这条,重名字段在列配置里分不出来 */
export function titleTaken(all: FieldRow[], d: FieldDraft) {
  const title = d.title.trim();
  return all.some(
    (f) => f.belongTo === d.belongTo && f.dataIndex !== d.dataIndex && f.title.trim() === title,
  );
}
