import {
  ALL_VIEW,
  type BaseParams,
  type BlackParams,
  type ColumnWidthSettings,
  type CompanyRow,
  type ContactRow,
  type FieldItem,
  type FieldScope,
  type FilterCondition,
  fieldListBelongTo,
  type ListQuery,
  type ListResult,
  type Logic,
  type RecycleQuery,
  SAVE_ENDPOINT,
  type SaveContactsContext,
  type SaveContactsForm,
  type SaveContactsSource,
  type TagAction,
  type ViewConfig,
  type ViewGroups,
  type ViewItem,
  type ViewType,
} from '@laifaxin/core/crm';
import { companyRecycleSort, recycleFilter } from '@laifaxin/core/crm-recycle';
import type { ApiClient } from './client';

export function createCrmApi(
  client: Pick<ApiClient, 'postEnvelope' | 'postEnvelopeFull'>,
  mapRecycleFilter: typeof recycleFilter = recycleFilter,
) {
  const { postEnvelope, postEnvelopeFull } = client;
  const listViewGroups = (type: ViewType) =>
    postEnvelope<ViewGroups>('/views/views-list', { type });

  const listPinnedViews = async (type: ViewType): Promise<ViewItem[]> => {
    const data = await postEnvelope<ViewItem[] | undefined>('/views/views-pin', { type });
    // 后端会把 'all' 混在里面,而「全部」这一页是前端自己插的第一格,重复了会出现两个
    return (data ?? []).filter((v) => v.viewId !== ALL_VIEW);
  };

  /** 参数名是 **viewType** 不是 type —— 全项目独此一份,顺手改成 type 会静默失效 */
  const savePinnedViews = (viewType: ViewType, viewIds: string[]) =>
    postEnvelope<unknown>('/views/views-pin-save', {
      viewType,
      viewIds: viewIds.length ? viewIds : [ALL_VIEW],
    });

  const getViewConfig = (viewId: string, type: ViewType) =>
    postEnvelope<ViewConfig>('/views/view-config', { viewId, type });

  const addView = (body: {
    name: string;
    shared: 'private' | 'team' | 'everyone';
    type: ViewType;
    logic: Logic;
    filters: FilterCondition[];
  }) => postEnvelope<ViewItem>('/views/view-add', body);

  const saveView = (body: {
    viewId: string;
    type: ViewType;
    logic: Logic;
    filters: FilterCondition[];
  }) => postEnvelope<unknown>('/views/view-save', body);

  const renameView = (viewId: string, type: ViewType, name: string) =>
    postEnvelope<unknown>('/views/view-rename', { viewId, type, name });

  const deleteView = (viewId: string, type: ViewType) =>
    postEnvelope<unknown>('/views/view-delete', { viewId, type });

  /** 筛选器可选字段。与列字段是两个接口,值域也不完全一样 */
  const listFilterFields = (type: ViewType) =>
    postEnvelope<FieldItem[]>('/views/view-fields', { type });

  const listFields = (viewType: ViewType, saveType: FieldScope) =>
    postEnvelope<FieldItem[]>('/fields/field-list', {
      belongTo: fieldListBelongTo(viewType),
      saveType,
    });

  const getColumnWidths = async (scope: string): Promise<ColumnWidthSettings> => {
    const config = await postEnvelope<{ fields?: ColumnWidthSettings } | null>(
      '/fields/get-config',
      {
        belongTo: scope,
        saveType: 'show',
      },
    );
    return config?.fields ?? {};
  };

  /** 与旧列表相同：只写 show 范围的列宽，不改字段显隐、顺序和表单配置。 */
  const saveColumnWidths = (viewType: ViewType, widths: Record<string, number>, scope?: string) =>
    postEnvelope<unknown>('/fields/save-fields-config', {
      belongTo: scope ?? (viewType === 'contacts' ? 'contact' : fieldListBelongTo(viewType)),
      saveType: 'show',
      fields: Object.fromEntries(Object.entries(widths).map(([key, width]) => [key, { width }])),
    });

  /**
   * 联系人列表。**viewId 永远发 'all'** —— 这是旧项目的实际行为,
   * 视图完全靠 filters 表达。按直觉传真实 viewId 会改变后端语义,要先跟后端确认。
   */
  const listContacts = (q: ListQuery) =>
    postEnvelope<ListResult<ContactRow>>('/contacts/contacts/show', { ...q, viewId: ALL_VIEW });

  /** 批量删除(进回收站,90 天) */
  const deleteContacts = (p: BaseParams) =>
    postEnvelope<{ backendId?: string }>('/contacts/contacts/delete', p);

  /** 邮箱验证。额度不足时回 success:false + code,由付费引导接手 */
  const verifyContacts = (p: BaseParams) =>
    postEnvelope<{ backendId?: string }>('/contacts/contacts/verify', p);

  /** 批量改字段 / 分配归属(同一个接口)。归属固定 changeField:'userid' */
  const modifyContacts = (
    p: BaseParams & { changeField: string; changeType: 'renew' | 'renull'; changeValue?: unknown },
  ) => postEnvelope<{ backendId?: string }>('/contacts/contacts/save', p);

  const batchContactTags = (p: BaseParams & { tagAction: TagAction; tagValues: string[] }) =>
    postEnvelope<unknown>('/contacts/contacts/tags', p);

  /* ---------- 跟进计划 ---------- */

  /**
   * 把选中的联系人加进一个或多个跟进计划。
   *
   * ⚠️ **入口在 contacts 这边,不是 sequences。**
   * `/sequences/contact-add` 只收 `{views, tags}` 整批加,收不了勾中的 id;
   * 要按当前选择加人,走的是这个。别把两个搞混。
   *
   * ⚠️ **是后台任务**:回 `{backendId}` 之后就返回了,真正的加人在后台跑。
   * 所以「成功」只代表任务派出去了,列表要过一会儿才变 ——
   * 提示语不能写「已加入 N 个」。
   *
   * `seqIds` 是数组,一次能加进多个计划。空数组后端回
   * `success:false, message:'序列不能为空'`;计划 id 无效回「无效的序列」。
   */
  const addContactsToSequences = (p: BaseParams & { seqIds: string[] }) =>
    postEnvelopeFull<{ backendId?: string }>('/contacts/contacts/sequence-add', p);

  /** 注意路径是 contacts-black 不是 contacts/black */
  const blacklistContacts = (p: BlackParams) =>
    postEnvelope<{ backendId?: string }>('/contacts/contacts-black', p);

  const getContact = (cid: string) => postEnvelope<ContactRow>('/contacts/contact-info', { cid });

  /** 联系人单字段快捷保存 */
  const saveContactField = (cid: string, dataIndex: string, value: unknown) =>
    postEnvelope<unknown>('/contacts/contact/save', { cid, [dataIndex]: value });

  const deleteContact = (cid: string) => postEnvelope<unknown>('/contacts/contact/delete', { cid });

  const listCompanies = (q: ListQuery) =>
    postEnvelope<ListResult<CompanyRow>>('/contacts/companies/show', { ...q, viewId: ALL_VIEW });

  const deleteCompanies = (p: BaseParams & { deleteContacts?: boolean }) =>
    postEnvelope<{ backendId?: string }>('/contacts/companies/delete', p);

  const modifyCompanies = (
    p: BaseParams & { changeField: string; changeType: 'renew' | 'renull'; changeValue?: unknown },
  ) => postEnvelope<{ backendId?: string }>('/contacts/companies/save', p);

  const batchCompanyTags = (p: BaseParams & { tagAction: TagAction; tagValues: string[] }) =>
    postEnvelope<unknown>('/contacts/companies/tags', p);

  const blacklistCompanies = (p: BlackParams) =>
    postEnvelope<{ backendId?: string }>('/contacts/companies-black', p);

  const listRecycleContacts = (q: RecycleQuery) =>
    postEnvelope<ListResult<ContactRow>>('/contacts/recycle/show', {
      current: q.current,
      pageSize: q.pageSize,
      filter: mapRecycleFilter(q, 'contacts'),
      sort: q.sort,
    });

  /** 回收站选中的必须是记录 _id，不能传联系人业务 cid。 */
  const restoreRecycleContacts = (p: BaseParams & { replace?: boolean; verify?: boolean }) =>
    postEnvelope<{ backendId?: string }>('/contacts/recycle/restore', {
      selectKeys: p.selectKeys,
      selectOption: p.selectOption,
      selectTotal: p.selectTotal,
      filter: mapRecycleFilter(p, 'contacts'),
      sort: p.selectSort,
      replace: p.replace ?? false,
      verify: p.verify ?? false,
    });

  const listRecycleCompanies = async (q: RecycleQuery) => {
    const data = await postEnvelope<ListResult<CompanyRow>>('/contacts/recycle-companies', {
      current: q.current,
      pageSize: q.pageSize,
      filter: mapRecycleFilter(q, 'companies'),
      sort: companyRecycleSort(q.sort),
    });
    return {
      ...data,
      list: (data.list ?? []).map((row) => ({
        ...row,
        name: row.name ?? row.orgName,
        country_code: row.country_code ?? row.countryCode,
      })),
    } as ListResult<CompanyRow>;
  };

  const restoreRecycleCompanies = (p: BaseParams & { replace?: boolean }) =>
    postEnvelope<{ backendId?: string }>('/contacts/recycle-companies-restore', {
      selectKeys: p.selectKeys,
      selectOption: p.selectOption,
      selectTotal: p.selectTotal,
      filter: mapRecycleFilter(p, 'companies'),
      sort: companyRecycleSort(p.selectSort),
      replace: p.replace ?? false,
      verify: false,
    });

  const saveContacts = (source: SaveContactsSource, body: SaveContactsForm & SaveContactsContext) =>
    postEnvelope<{ id?: string }>(SAVE_ENDPOINT[source], body);
  return {
    listViewGroups,
    listPinnedViews,
    savePinnedViews,
    getViewConfig,
    addView,
    saveView,
    renameView,
    deleteView,
    listFilterFields,
    listFields,
    getColumnWidths,
    saveColumnWidths,
    listContacts,
    deleteContacts,
    verifyContacts,
    modifyContacts,
    batchContactTags,
    addContactsToSequences,
    blacklistContacts,
    getContact,
    saveContactField,
    deleteContact,
    listCompanies,
    deleteCompanies,
    modifyCompanies,
    batchCompanyTags,
    blacklistCompanies,
    listRecycleContacts,
    restoreRecycleContacts,
    listRecycleCompanies,
    restoreRecycleCompanies,
    saveContacts,
  };
}
