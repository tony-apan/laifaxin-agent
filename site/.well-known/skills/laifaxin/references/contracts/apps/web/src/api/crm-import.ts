import { postEnvelope } from '@/api/auth';
import type { FieldItem } from '@/api/crm';
import type { PageResult } from '@/api/expenses';
import type { UploadedFile } from '@/api/upload';

export type ImportEntity = 'contacts' | 'company';

/**
 * 客户管理 · 导入联系人与公司。四步:上传 Excel → 选工作表与表头行 → 列对字段 → 看进度。
 *
 * 与老项目的差异(每条都对应契约里核验过的坑):
 * - **「哪一列当标签」不再硬编码第 3 列**。老项目五处写的是 `importFields[2] === 'tags'`,
 *   这个特性只有当用户恰好把标签映射到第三列时才生效
 * - **自动匹配对空表头短路**,老项目 `headerData` 为空时会陷入无限重渲染
 * - **手工改过映射之后不再被自动匹配覆盖**,老项目退回上一步再前进就全丢了
 * - **去重是全扫**,老项目只清掉第一处重复
 * - **`tagsDelOld` 在界面上藏起来时会被重置**,老项目照样提交
 * - 状态是显式字典 + 未知兜底,老项目按数组下标取,越界就是一个空 Chip
 */

/* ---------- 第一步:上传后拿到的预览 ---------- */

export interface SheetPreview {
  sheetName: string;
  sheetValue: unknown[][];
}

export interface ImportPreview {
  /** 导入任务 id。**全小写 iid**,不是 id / _id */
  iid: string;
  sheetNames: string[];
  workbook: SheetPreview[];
}

/** 公司沿用旧项目的通用文件接口；联系人继续使用原有接口。 */
export const importFile = (file: UploadedFile, entity: ImportEntity = 'contacts') =>
  postEnvelope<ImportPreview | undefined>(
    entity === 'company' ? '/file/import-file' : '/contacts/contacts/import-file',
    {
      ...file,
      ...(entity === 'company' ? { dataType: 'company' } : {}),
    },
  ).then((r) => ({
    iid: r?.iid ?? '',
    sheetNames: r?.sheetNames ?? [],
    workbook: r?.workbook ?? [],
  }));

/** 预览最多渲染这么多行 —— 后端是否已截断没有定论,前端自己兜住,免得大表把内存撑爆 */
export const PREVIEW_ROWS = 10;

export const sheetOf = (p: ImportPreview, name: string) =>
  p.workbook.find((w) => w.sheetName === name) ?? p.workbook[0];

/** 表头行是 1-based 的行号,相对整张表 */
export const headerOf = (sheet: SheetPreview | undefined, begin: number): string[] =>
  ((sheet?.sheetValue[begin - 1] ?? []) as unknown[]).map((v) => String(v ?? '').trim());

export const bodyOf = (sheet: SheetPreview | undefined, begin: number): unknown[][] =>
  (sheet?.sheetValue ?? []).slice(begin);

/* ---------- 第三步:列 → 字段 ---------- */

/** 1=仅新增 2=仅更新 3=新增并更新 */
export const IMPORT_TYPES = [1, 2, 3] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

/** 索引即列号,值是目标字段的 dataIndex;null = 这一列不导入 */
export type FieldMapping = (string | null)[];

export interface ImportDraft {
  iid: string;
  importSheet: string;
  importBegin: number;
  importFields: FieldMapping;
  importType: ImportType;
  /** 整批统一打的标签,元素是标签 id */
  tags: string[];
  tagsDelOld: boolean;
  /** 公司更新时，选中的字段需同时匹配。 */
  updateByFields?: string[];
}

export const emptyImportDraft = (iid = '', entity: ImportEntity = 'contacts'): ImportDraft => ({
  iid,
  importSheet: '',
  importBegin: 1,
  importFields: [],
  importType: 1,
  tags: [],
  tagsDelOld: false,
  ...(entity === 'company' ? { updateByFields: ['orgName', 'domain'] } : {}),
});

/** 邮箱是唯一键,后端靠它判新增还是更新 */
export const KEY_FIELD = 'email';

/** 能被导入的字段。老项目对空表头不设防,这里短路返回 */
export function autoMatchFields(header: string[], fields: FieldItem[]): FieldMapping {
  if (header.length === 0) return [];
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');
  const byTitle = new Map(fields.map((f) => [f.title ?? '', f.dataIndex ?? '']));
  const byIndex = new Map(fields.map((f) => [f.dataIndex ?? '', f.dataIndex ?? '']));
  const loose = new Map<string, string>();
  for (const f of fields) {
    // 后写的不覆盖先写的:精确匹配优先级更高
    for (const k of [f.title ?? '', f.dataIndex ?? '']) {
      if (k && !loose.has(norm(k))) loose.set(norm(k), f.dataIndex ?? '');
    }
  }

  const used = new Set<string>();
  return header.map((name) => {
    // 先精确 title,再精确 dataIndex,最后归一化后再来一轮
    const hit = byTitle.get(name) || byIndex.get(name) || loose.get(norm(name)) || null;
    // 同一个字段不能被两列同时占用
    if (!hit || used.has(hit)) return null;
    used.add(hit);
    return hit;
  });
}

/** 改某一列的映射。同一个字段只能占一列,**全扫**清掉其它列上的同值 */
export function setMapping(fields: FieldMapping, col: number, value: string | null): FieldMapping {
  const next = fields.map((v, i) => (value && v === value && i !== col ? null : v));
  next[col] = value;
  return next;
}

/** 有没有哪一列被映射成了标签 —— 老项目写死判第 3 列 */
export const hasTagColumn = (fields: FieldMapping) => fields.includes('tags');

/**
 * 联系人有标签列时省略批次标签；公司按旧通用接口传批次标签并优先采用。
 * `tagsDelOld` 只在界面上真的能改到时才发。
 */
export function importBody(
  d: ImportDraft,
  entity: ImportEntity = 'contacts',
): Record<string, unknown> {
  const byColumn = entity === 'contacts' && hasTagColumn(d.importFields);
  const canDelOld = d.importType !== 1 && !byColumn;
  return {
    iid: d.iid,
    importSheet: d.importSheet,
    importBegin: d.importBegin,
    importFields: d.importFields,
    importType: d.importType,
    ...(byColumn ? {} : { tags: d.tags }),
    tagsDelOld: canDelOld ? d.tagsDelOld : false,
    ...(entity === 'company'
      ? { dataType: 'company', updateByFields: d.updateByFields ?? [] }
      : {}),
  };
}

/** 返回 i18n key。顺序按「先说最要紧的」排,老项目把标签那条放在最前面 */
export function validateImport(
  d: ImportDraft,
  header: string[],
  entity: ImportEntity = 'contacts',
): string {
  if (d.importFields.length !== header.length) return 'imp.errMappingBroken';
  if (d.importFields.every((f) => !f)) return 'imp.errNoColumn';
  if (entity === 'company') {
    if (!d.importFields.includes('orgName')) return 'companyImport.errNoName';
    if (d.importType !== 1) {
      if (!d.updateByFields?.length) return 'companyImport.errNoMatch';
      if (
        d.updateByFields.some(
          (f) => !['orgName', 'domain'].includes(f) || !d.importFields.includes(f),
        )
      )
        return 'companyImport.errMatchMapping';
    }
    return '';
  }
  if (!d.importFields.includes(KEY_FIELD)) return 'imp.errNoEmail';
  if (!hasTagColumn(d.importFields) && d.tags.length === 0) return 'imp.errNoTag';
  return '';
}

export const importSave = (d: ImportDraft, entity: ImportEntity = 'contacts') =>
  postEnvelope<{ backendId?: string } | undefined>(
    entity === 'company' ? '/file/import-save' : '/contacts/contacts/import-save',
    importBody(d, entity),
  );

/* ---------- 第四步:进度 ---------- */

/** 0=中断 1=进行中 2=完成。老项目按数组下标取,越界渲染成空 Chip */
export const IMPORT_STATUS = { 0: 'broken', 1: 'running', 2: 'done' } as const;
export type ImportStatusKey = (typeof IMPORT_STATUS)[keyof typeof IMPORT_STATUS] | 'unknown';

export const importStatusKey = (v: number): ImportStatusKey =>
  (IMPORT_STATUS as Record<number, ImportStatusKey>)[v] ?? 'unknown';

export const isImportSettled = (v: number) => v === 0 || v === 2;

export interface ImportError {
  row: number;
  code: number;
  message?: string;
  email?: string;
  value?: string;
}

export interface ImportStatus {
  status: number;
  total: number;
  finished: number;
  /** 信封里的 success 是布尔,这个是**条数** —— 老项目同名不同义,这里改名 */
  successCount: number;
  failCount: number;
  addSuccess: number;
  addFail: number;
  updateSuccess: number;
  errorLogs: ImportError[];
}

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

export const importStatus = (iid: string) =>
  postEnvelope<Record<string, unknown> | undefined>('/contacts/contacts/import-status', {
    iid,
  }).then((r): ImportStatus => {
    const d = r ?? {};
    return {
      status: num(d.status, 1),
      total: num(d.total),
      finished: num(d.finished),
      successCount: num(d.success),
      failCount: num(d.fail),
      addSuccess: num(d.addSuccess),
      addFail: num(d.addFail),
      updateSuccess: num(d.updateSuccess),
      errorLogs: Array.isArray(d.errorLogs) ? (d.errorLogs as ImportError[]) : [],
    };
  });

export const importProgress = (s: ImportStatus) =>
  s.total === 0 ? 0 : Math.floor((s.finished * 100) / s.total);

/**
 * 失败原因。`0` 是邮箱格式错误、`-1` 是联系人已存在;别的码老项目在两处解释不同,
 * 一处原样显示裸数字、一处一律归成「邮箱重复」。这里有 message 就用 message,
 * 否则按字典,再不认识就显示码值。
 */
export const IMPORT_ERROR_CODES: Record<number, string> = {
  0: 'imp.errCodeFormat',
  [-1]: 'imp.errCodeExists',
};

/* ---------- 导入记录 ---------- */

export interface ImportRecord {
  /** 后端字段是 iid */
  id: string;
  file_name: string;
  tags: string[];
  total: number;
  successCount: number;
  failCount: number;
  status: number;
  userid: string;
  create_time: number;
  downUrl: string;
  errors: ImportError[];
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

const toRecord = (r: Record<string, unknown>): ImportRecord => ({
  id: str(r.iid),
  file_name: str(r.file_name),
  tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  total: num(r.total),
  successCount: num(r.success),
  failCount: num(r.fail),
  status: num(r.status, 1),
  userid: str(r.userid),
  create_time: num(r.create_time),
  downUrl: str(r.downUrl),
  errors: Array.isArray(r.errors) ? (r.errors as ImportError[]) : [],
});

export interface HistoryQuery {
  current: number;
  pageSize: number;
  /** 按导入人筛选，元素为 userid；不传或空数组表示不限。 */
  owners?: string[];
  sort: Record<string, 1 | -1>;
}

export const DEFAULT_HISTORY_SORT: Record<string, 1 | -1> = { create_time: -1 };

export const listImportHistory = (q: HistoryQuery) =>
  postEnvelope<PageResult<Record<string, unknown>> | undefined>('/contacts/import/history', {
    current: q.current,
    pageSize: q.pageSize,
    sort: q.sort,
    filter: q.owners?.length ? { owners: q.owners } : {},
  }).then((r) => ({
    list: (r?.list ?? []).map(toRecord),
    total: num(r?.total),
  }));

/** 单删与批删统一成一个形状。老项目一个发 `{iid}` 一个发 `{iids}` */
export const deleteImportHistory = (ids: string[]) =>
  postEnvelope<unknown>('/contacts/import/histories-delete', { iids: ids });
