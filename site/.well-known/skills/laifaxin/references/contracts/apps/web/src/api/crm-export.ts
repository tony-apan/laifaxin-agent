import { postEnvelope } from '@/api/auth';
import { type BaseParams, clampFrontCount, type SelectOption } from '@/api/crm';
import type { PageResult } from '@/api/expenses';

/**
 * 客户管理 · 导出。发起是同步的(只拿一个任务 id),真正的活在后端跑,
 * 前端轮询 `export-status` 等下载链接。
 *
 * 与老项目的差异:
 * - **终态一律停轮询**。老项目只在 `status===1`(成功)时 cancel,额度不足/数据为空/
 *   失败这三个终态都不停,3 秒一次一直转下去,而且 `downloadId` 永不清空 ——
 *   此后所有导出都被「正在导出中」挡死,只能刷新页面
 * - **两个发起入口合并成一个**。老项目 `contacts/index.tsx` 与 `table-toolbar.tsx`
 *   各传一套参数,其中工具栏那条把 `selectTotal` 传成了 `pageSize` 而不是当前页真实行数
 * - 备注改名判 `success` 之后才提示成功(老项目 HTTP 200 就弹「操作成功」)
 */

/* ---------- 发起导出 ---------- */

/** 全部字段 / 只导当前显示的那些列 */
export type ExportFieldScope = 'all' | 'part';
export type ExportEntity = 'contacts' | 'company' | 'map';

/** 老项目弹窗里 xlsx 的选项被注释掉了,实际恒为 csv */
export const EXPORT_FORMAT = 'csv';

export const exportContacts = (params: BaseParams, fieldType: ExportFieldScope) =>
  postEnvelope<{ id?: string } | undefined>('/contacts/contacts/exportSave', {
    ...params,
    fieldType,
    exportType: EXPORT_FORMAT,
  }).then((r) => r?.id ?? '');

/** 公司任务与联系人共用进度、额度和导出记录，发起端点不同。 */
export const exportCompanies = (params: BaseParams, fieldType: ExportFieldScope) =>
  postEnvelope<{ id?: string } | undefined>('/contacts/companies-export', {
    ...params,
    fieldType,
    exportType: EXPORT_FORMAT,
  }).then((r) => r?.id ?? '');

/** 谷歌地图与 CRM 共用导出任务进度、额度及历史。 */
export const exportMapData = (params: BaseParams, fieldType: ExportFieldScope) =>
  postEnvelope<{ id?: string } | undefined>('/search/map-data-export', {
    ...params,
    fieldType,
    exportType: EXPORT_FORMAT,
  }).then((r) => r?.id ?? '');

/** 工具栏打开时冻结当前页的 ID、筛选和排序；只按弹窗选择改变范围。 */
export function exportScopeParams(
  page: BaseParams,
  option: SelectOption,
  front: number,
  total: number,
): BaseParams {
  return {
    ...page,
    selectOption: option,
    selectKeys: option === 'current' ? page.selectKeys : [],
    selectTotal:
      option === 'current'
        ? page.selectKeys.length
        : option === 'front'
          ? clampFrontCount(front, 1, total)
          : total,
  };
}

/* ---------- 配额 ---------- */

export interface ExportQuota {
  /** 剩余额度 */
  count: number;
  /** 单日限额，按数据条数计数 */
  quota: number;
  /** 今日已用 */
  today: number;
}

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

export const exportQuota = () =>
  postEnvelope<Partial<ExportQuota> | undefined>('/contacts/export-quota', {}).then((r) => ({
    count: num(r?.count),
    quota: num(r?.quota),
    today: num(r?.today),
  }));

/* ---------- 任务状态 ---------- */

/**
 * 0/其它=排队或进行中,1=完成可下载,2=额度不足,3=数据为空,9=失败。
 * 老项目把这些散在一个 switch 里,只有 1 会停轮询。
 */
export const EXPORT_STATUS = {
  1: 'done',
  2: 'noQuota',
  3: 'empty',
  9: 'failed',
} as const;

export type ExportStatusKey = (typeof EXPORT_STATUS)[keyof typeof EXPORT_STATUS] | 'running';

export const exportStatusKey = (v: number): ExportStatusKey =>
  (EXPORT_STATUS as Record<number, ExportStatusKey>)[v] ?? 'running';

/** 四个终态都要停 —— 只认「成功」是老项目那个把导出功能锁死的根因 */
export const isExportSettled = (v: number) => v === 1 || v === 2 || v === 3 || v === 9;

export interface ExportTask {
  /** 这个接口回的是 `_id`,而列表行与 exportSave 回的是 `id` */
  id: string;
  table: string;
  status: number;
  dataLength: number;
  downUrl: string;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

export const exportStatus = (id: string) =>
  postEnvelope<Record<string, unknown> | undefined>('/contacts/export-status', { id }).then(
    (r): ExportTask => {
      if (!r) throw new Error('Export task not found');
      return {
        id: str(r?._id) || str(r?.id),
        table: str(r?.table),
        status: num(r?.status),
        dataLength: num(r?.dataLength),
        downUrl: str(r?.downUrl),
      };
    },
  );

/* ---------- 导出记录 ---------- */

export interface ExportRecord {
  id: string;
  /** 任务名称,可改 */
  remark: string;
  status: number;
  userid: string;
  fieldLength: number;
  dataLength: number;
  /** 毫秒 */
  times: number;
  create_time: number;
  downUrl: string;
}

const toRecord = (r: Record<string, unknown>): ExportRecord => ({
  id: str(r.id) || str(r._id),
  remark: str(r.remark),
  status: num(r.status),
  userid: str(r.userid),
  fieldLength: num(r.fieldLength),
  dataLength: num(r.dataLength),
  times: num(r.times),
  create_time: num(r.create_time),
  downUrl: str(r.downUrl),
});

export interface ExportHistoryQuery {
  current: number;
  pageSize: number;
  /** 按导出人筛,元素是 userid */
  owners: string[];
  sort: Record<string, 1 | -1>;
}

export const DEFAULT_EXPORT_SORT: Record<string, 1 | -1> = { create_time: -1 };

export const listExportHistory = (q: ExportHistoryQuery) =>
  postEnvelope<PageResult<Record<string, unknown>> | undefined>('/contacts/export/history', {
    current: q.current,
    pageSize: q.pageSize,
    sort: q.sort,
    // 此接口的 TableDataInput/controller 读取单数 filter，与批量动作的 filters 不同。
    filter: q.owners.length > 0 ? { owners: q.owners } : {},
  }).then((r) => ({
    list: (r?.list ?? []).map(toRecord),
    total: num(r?.total),
  }));

export const renameExportRecord = (id: string, remark: string) =>
  postEnvelope<unknown>('/contacts/export/history-remark', { id, remark: remark.trim() });

/** 单删与批删统一成一个形状 —— 老项目一个发 `{id}` 一个发 `{ids}` */
export const deleteExportRecords = (ids: string[]) =>
  postEnvelope<unknown>('/contacts/export/histories-delete', { ids });

/** 下属成员,给「导出人」筛选用 */
export interface SubordinateUser {
  userid: string;
  nickname: string;
  email: string;
}

export const listSubordinateUsers = () =>
  postEnvelope<Record<string, unknown>[] | undefined>('/enterprise/subordinate-users', {}).then(
    (r) =>
      (r ?? []).map(
        (u): SubordinateUser => ({
          userid: str(u.userid),
          nickname: str(u.nickname),
          email: str(u.email),
        }),
      ),
  );

export const subordinateLabel = (u: SubordinateUser) => u.nickname || u.email || u.userid;

export const REMARK_MAX = 64;

export function validateRemark(v: string) {
  const s = v.trim();
  if (!s) return 'exp.errRemarkEmpty';
  if (s.length > REMARK_MAX) return 'exp.errRemarkLong';
  return '';
}

/** `3.42 秒` / `1 分 05 秒` */
export function fmtDuration(ms: number) {
  if (!ms) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
