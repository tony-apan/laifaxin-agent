import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  copySequence,
  deleteSequence,
  listMassTasks,
  listSequences,
  listTracks,
  type MassAction,
  type MassListQuery,
  type MassRemovalAction,
  massTaskAction,
  massTaskBulk,
  massTaskCounts,
  massTaskLive,
  renameMassTask,
  renameSequence,
  type SeqListQuery,
  setSequenceActive,
  type TrackListQuery,
} from '@/api/marketing';
import { getAccountCurrent } from './account';
import {
  ALL_VIEW,
  deleteContact,
  type FieldScope,
  getContact,
  getViewConfig as getCrmViewConfig,
  type ListQuery,
  listCompanies,
  listContacts,
  listFields,
  listFilterFields,
  listPinnedViews,
  listRecycleCompanies,
  listRecycleContacts,
  listViewGroups,
  type RecycleQuery,
  saveContactField,
  type ViewType,
} from './crm';
import { listWorkspaces } from './enterprise';
import {
  countOrders,
  getSellGoods,
  listBilling,
  listOrders,
  type PageQuery,
  type PageResult,
} from './expenses';
import { listProductOptions } from './products';
import {
  createTask,
  deleteTask,
  deleteTasks,
  downloadSaveTask,
  endSaveTask,
  getCompanyDetail,
  getSaveTaskCounts,
  getSaveTaskInfo,
  getTaskInfo,
  KEYWORD_MAX,
  KEYWORD_MIN,
  type LinkedinQuery,
  listRefineTasks,
  listSaveTasks,
  listSimilarCompanies,
  previewCompanies,
  type RefineTask,
  renameSaveTask,
  renameTask,
  type SaveStatus,
  type SaveTask,
  searchLinkedin,
  startSaveTask,
  stopSaveTask,
  type TaskListQuery,
} from './prospect';
import {
  controlRatingTask,
  deleteRatingTasks,
  getRatingReport,
  getRatingTaskInfo,
  listRatingResults,
  listRatingTasks,
  type RatingAction,
  type RatingResultQuery,
  type RatingTask,
  type RatingTaskQuery,
  renameRatingTask,
} from './rating';
import {
  ALL_VIEW_ID,
  addInferenceProduct,
  type CompanySearchQuery,
  deleteInferenceProduct,
  generateSegments,
  getInferenceProfile,
  getRefineBenefits,
  getViewConfig,
  type InferenceProfile,
  listInferenceProducts,
  listSegments,
  listViews,
  renameInferenceProduct,
  saveInferenceProfile,
  searchCompanies,
} from './refine';
import { addTag, emptyTag, listTags, type TagType } from './tags';
import { getGiveStatus, getMessageCount, listCoupons, listTasks } from './topbar';

/* ---------- 账号 ---------- */
/** 当前账号(点数/会员/昵称)。登录会话只带 token+uid,这些要另取 */
export function useAccountCurrent() {
  return useQuery({
    queryKey: ['account-current'],
    queryFn: getAccountCurrent,
    staleTime: 60_000,
  });
}

/* ---------- 费用中心 ----------
   订单和消费明细都是服务端分页,查询参数进 queryKey,翻页/切页签自动重取。
   placeholderData 保留上一页,翻页时表格不闪空。 */
export function useSellGoods() {
  return useQuery({ queryKey: ['sell-goods'], queryFn: getSellGoods, staleTime: 60_000 });
}

export function useOrders(q: PageQuery) {
  return useQuery({
    queryKey: ['orders', q],
    queryFn: () => listOrders(q),
    placeholderData: (prev) => prev,
  });
}

export function useOrderCounts() {
  return useQuery({ queryKey: ['order-counts'], queryFn: countOrders, staleTime: 30_000 });
}

export function useBillingRecords(q: PageQuery) {
  return useQuery({
    queryKey: ['billing-records', q],
    queryFn: () => listBilling(q),
    placeholderData: (prev) => prev,
  });
}

/* ---------- 顶栏 ----------
   福利状态每 30 分钟更新。
   面板内容按需拉取(enabled),不开面板不请求。 */
export function useWorkspaces(enabled = true) {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    staleTime: 60_000,
    enabled,
  });
}

export function useCoupons(enabled: boolean) {
  return useQuery({ queryKey: ['coupons'], queryFn: listCoupons, enabled, staleTime: 30_000 });
}

export function useGiveStatus() {
  return useQuery({
    queryKey: ['give-status'],
    queryFn: getGiveStatus,
    refetchInterval: 30 * 60_000,
  });
}

export function useBackendTasks() {
  const client = useQueryClient();
  return useQuery({
    queryKey: ['backend-tasks'],
    queryFn: ({ signal }) => listTasks(client, signal),
    staleTime: Infinity,
    refetchInterval: ({ state }) =>
      state.data?.some((task) => task.status !== 'finished' && task.status !== 'aborted')
        ? 30_000
        : false,
  });
}

export function useMessageCount() {
  return useQuery({
    queryKey: ['message-count'],
    queryFn: getMessageCount,
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
  });
}

/* ---------- AI 数据库:企业检索 ---------- */

/**
 * 企业检索。retry 关掉:超额(QuotaError)是业务结论不是网络抖动,
 * 重试三次只会让用户多等两秒再看到同一句「今天的查看额度用完了」。
 */
export function useCompanySearch(q: CompanySearchQuery, enabled = true) {
  return useQuery({
    queryKey: ['refine-companies', q],
    queryFn: () => searchCompanies(q),
    enabled,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useRefineViews() {
  return useQuery({ queryKey: ['refine-views'], queryFn: listViews, staleTime: 60_000 });
}

export function useViewConfig(viewId: string) {
  return useQuery({
    queryKey: ['refine-view-config', viewId],
    queryFn: () => getViewConfig(viewId),
    // 「所有企业」是内置视图,没有服务端配置可取
    enabled: viewId !== ALL_VIEW_ID,
  });
}

/** 查看额度。每次搜索成功后都要刷新,所以 staleTime 给 0 */
export function useRefineBenefits() {
  return useQuery({ queryKey: ['refine-benefits'], queryFn: getRefineBenefits });
}

/* ---------- AI 数据库:客群推演 ---------- */

export function useInferenceProducts() {
  return useQuery({ queryKey: ['inference-products'], queryFn: listInferenceProducts });
}

export function useSegments(productId: string, enabled = true) {
  return useQuery({
    queryKey: ['inference-segments', productId],
    queryFn: () => listSegments(productId),
    enabled: enabled && !!productId,
  });
}

export function useInferenceProfile(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['inference-profile', productId],
    queryFn: () => getInferenceProfile(productId),
    enabled: enabled && !!productId,
    // 每次打开都重取:别人可能刚在另一个标签页改过档案
    gcTime: 0,
  });
}

/** 新建方案。扣 2 点,所以成功后连点数一起刷新 —— 旧项目这里漏了刷新,顶栏点数会停在旧值 */
export function useAddInferenceProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => addInferenceProduct(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inference-products'] });
      qc.invalidateQueries({ queryKey: ['account-current'] });
    },
  });
}

export function useGenerateSegments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => generateSegments(productId),
    onSuccess: (_d, productId) => {
      qc.invalidateQueries({ queryKey: ['inference-segments', productId] });
      qc.invalidateQueries({ queryKey: ['account-current'] });
    },
  });
}

export function useSaveInferenceProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { productId: string; patch: InferenceProfile }) =>
      saveInferenceProfile(v.productId, v.patch),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['inference-profile', v.productId] });
      qc.invalidateQueries({ queryKey: ['inference-products'] });
    },
  });
}

export function useRenameInferenceProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { productId: string; name: string }) =>
      renameInferenceProduct(v.productId, v.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inference-products'] }),
  });
}

export function useDeleteInferenceProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => deleteInferenceProduct(productId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inference-products'] }),
  });
}

/* ---------- 搜客引擎:检索落地页 ---------- */

/** 输入联想。少于 3 字符不发 —— 后端也拦,但白跑一趟只会让下拉闪一下旧结果 */
export function usePreviewCompanies(keyword: string) {
  const kw = keyword.trim();
  return useQuery({
    queryKey: ['preview-companies', kw],
    queryFn: () => previewCompanies(kw),
    enabled: kw.length >= KEYWORD_MIN && kw.length <= KEYWORD_MAX,
    retry: false,
    // 联想是打字触发的,上一次的结果顶着比闪空白好
    placeholderData: (prev) => prev,
  });
}

/** 公司背调详情。retry 关掉:额度用尽是业务结论,重试只是让用户多等 */
export function useCompanyDetail(
  domainOrId: string,
  charge?: { isCharge?: boolean; autoCharge?: boolean },
) {
  return useQuery({
    queryKey: ['company-detail', domainOrId, charge],
    queryFn: () => getCompanyDetail(domainOrId, charge),
    enabled: !!domainOrId,
    retry: false,
  });
}

export function useSimilarCompanies(domain: string, enabled: boolean) {
  return useQuery({
    queryKey: ['similar-companies', domain],
    queryFn: () => listSimilarCompanies(domain),
    enabled: enabled && !!domain,
  });
}

/* ---------- 搜客引擎:领英 ---------- */

export function useLinkedinSearch(q: LinkedinQuery, enabled = true) {
  return useQuery({
    queryKey: ['linkedin-search', q],
    queryFn: () => searchLinkedin(q),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/* ---------- 搜客引擎:批量搜索任务 ---------- */

export function useRefineTasks(q: TaskListQuery) {
  return useQuery({
    queryKey: ['refine-tasks', q],
    queryFn: () => listRefineTasks(q),
    placeholderData: (prev) => prev,
    // 任务在后台跑,列表得自己动起来,否则用户只能一直点刷新
    refetchInterval: 30_000,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refine-tasks'] }),
  });
}

export function useTaskInfo(taskId: string) {
  return useQuery({
    queryKey: ['refine-task-info', taskId],
    queryFn: () => getTaskInfo(taskId),
    enabled: !!taskId,
    gcTime: 0,
  });
}

export function useRenameTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { taskId: string; name: string }) => renameTask(v.taskId, v.name),
    onSuccess: async (_, { taskId, name }) => {
      qc.setQueryData<RefineTask>(['refine-task-info', taskId], (task) =>
        task ? { ...task, name } : task,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['refine-tasks'] }),
        qc.invalidateQueries({ queryKey: ['refine-task-info', taskId] }),
      ]);
    },
  });
}

export function useDeleteTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? deleteTask(ids[0]) : deleteTasks(ids)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refine-tasks'] }),
  });
}

/* ---------- 搜客引擎:客户保存记录 ---------- */

export function useSaveTasks(q: {
  current: number;
  pageSize: number;
  filter: { status: SaveStatus; keyword?: string };
  sort?: Record<string, 1 | -1>;
}) {
  return useQuery({
    queryKey: ['save-tasks', q],
    queryFn: () => listSaveTasks(q),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
}

export function useSaveTaskCounts() {
  return useQuery({ queryKey: ['save-task-counts'], queryFn: getSaveTaskCounts });
}

export function useSaveTaskInfo(saveId: string) {
  const qc = useQueryClient();
  const cached = qc
    .getQueriesData<PageResult<SaveTask>>({ queryKey: ['save-tasks'] })
    .map(([key, data]) => ({
      task: data?.list?.find((item) => item._id === saveId),
      updatedAt: qc.getQueryState(key)?.dataUpdatedAt ?? 0,
    }))
    .filter((entry) => entry.task)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return useQuery({
    queryKey: ['save-task-info', saveId],
    queryFn: ({ signal }) => getSaveTaskInfo(saveId, signal),
    enabled: !!saveId,
    initialData: cached?.task,
    initialDataUpdatedAt: cached?.updatedAt,
    staleTime: 30_000,
  });
}

/** 保存作业的四个遥控动作。成功后列表与计数一起刷 —— 旧项目只刷列表,页签数字会停在旧值 */
export function useSaveTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: 'start' | 'stop' | 'end'; saveId: string }) => {
      if (v.action === 'start') return startSaveTask(v.saveId);
      if (v.action === 'stop') return stopSaveTask(v.saveId);
      return endSaveTask(v.saveId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['save-tasks'] });
      qc.invalidateQueries({ queryKey: ['save-task-counts'] });
    },
  });
}

export function useRenameSaveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { saveId: string; name: string }) => renameSaveTask(v.saveId, v.name),
    onSuccess: async (_, { saveId, name }) => {
      await qc.cancelQueries({ queryKey: ['save-task-info', saveId] });
      qc.setQueryData<SaveTask | null>(['save-task-info', saveId], (task) =>
        task ? { ...task, name } : task,
      );
      qc.setQueriesData<PageResult<SaveTask>>({ queryKey: ['save-tasks'] }, (data) =>
        data
          ? {
              ...data,
              list: data.list?.map((task) => (task._id === saveId ? { ...task, name } : task)),
            }
          : data,
      );
      return qc.invalidateQueries({ queryKey: ['save-tasks'] });
    },
  });
}

export function useDownloadSaveTask() {
  return useMutation({ mutationFn: (saveId: string) => downloadSaveTask(saveId) });
}

/* ---------- 客户管理:视图与字段 ---------- */

export function useViewGroups(type: ViewType) {
  return useQuery({
    queryKey: ['crm-views', type],
    queryFn: () => listViewGroups(type),
    staleTime: 60_000,
  });
}

export function usePinnedViews(type: ViewType) {
  return useQuery({ queryKey: ['crm-pinned-views', type], queryFn: () => listPinnedViews(type) });
}

export function useCrmViewConfig(viewId: string, type: ViewType) {
  return useQuery({
    queryKey: ['crm-view-config', type, viewId],
    queryFn: () => getCrmViewConfig(viewId, type),
    // 「全部」是前端插的内置页签,没有服务端配置可取
    enabled: viewId !== ALL_VIEW,
  });
}

/** 筛选器可选字段。与列字段是两个接口,值域不完全一样 */
export function useFilterFields(type: ViewType) {
  return useQuery({
    queryKey: ['crm-filter-fields', type],
    queryFn: () => listFilterFields(type),
    staleTime: 5 * 60_000,
  });
}

export function useFields(belongTo: ViewType, saveType: FieldScope) {
  return useQuery({
    queryKey: ['crm-fields', belongTo, saveType],
    queryFn: () => listFields(belongTo, saveType),
    staleTime: 5 * 60_000,
  });
}

/* ---------- 客户管理:标签 ---------- */

export function useTags(type: TagType) {
  return useQuery({
    queryKey: ['crm-tags', type],
    queryFn: () => listTags(type),
    staleTime: 60_000,
  });
}

/** 选择器里随手新建一个标签:只有名字,颜色随机、落在顶级目录 */
export function useAddTag(type: TagType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => addTag(type, { ...emptyTag(), name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-tags', type] });
      qc.invalidateQueries({ queryKey: ['tags', type] });
    },
  });
}

/* ---------- 客户管理:联系人 ---------- */

export function useContacts(q: ListQuery, enabled = true) {
  return useQuery({
    queryKey: ['crm-contacts', q],
    queryFn: () => listContacts(q),
    enabled,
    placeholderData: (prev) => prev,
    // 同一页只轮询一次，直到所有可见联系人的验证任务结束。
    refetchInterval: (query) =>
      query.state.data?.list?.some((row) => row.verify_status === 'waiting') ? 15_000 : false,
  });
}

export function useContact(cid: string) {
  return useQuery({
    queryKey: ['crm-contact', cid],
    queryFn: () => getContact(cid),
    enabled: !!cid,
    retry: false,
    gcTime: 0,
    // 提交接口只负责入队；详情打开期间继续获取实际验证结果。
    refetchInterval: (query) => (query.state.data?.verify_status === 'waiting' ? 5_000 : false),
  });
}

/** 单字段快捷保存，共用联系人保存接口 */
export function useSaveContactField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { cid: string; dataIndex: string; value: unknown }) =>
      saveContactField(v.cid, v.dataIndex, v.value),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['crm-contact', v.cid] });
      qc.invalidateQueries({ queryKey: ['crm-contacts'] });
      qc.invalidateQueries({ queryKey: ['email-contact'] });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cid: string) => deleteContact(cid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm-contacts'] });
      void qc.invalidateQueries({ queryKey: ['email-contact'] });
    },
  });
}

/* ---------- 客户管理:公司 ---------- */

export function useCompanies(q: ListQuery, enabled = true) {
  return useQuery({
    queryKey: ['crm-companies', q],
    queryFn: () => listCompanies(q),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/* ---------- 客户管理:回收站 ---------- */

export function useRecycle(kind: 'contacts' | 'companies', q: RecycleQuery) {
  return useQuery({
    queryKey: ['crm-recycle', kind, q],
    queryFn: () => (kind === 'contacts' ? listRecycleContacts(q) : listRecycleCompanies(q)),
    placeholderData: (prev, previousQuery) =>
      previousQuery?.queryKey[1] === kind ? prev : undefined,
  });
}

/* ---------- 批量评分任务 ---------- */

export function useProductProfiles() {
  return useQuery({
    queryKey: ['product-profiles'],
    queryFn: () => listProductOptions(),
    staleTime: 60_000,
  });
}

/** 任务在后台跑,列表得自己动;没有在跑的任务就别一直打后端 */
export function useRatingTasks(q: RatingTaskQuery) {
  return useQuery({
    queryKey: ['rating-tasks', q],
    queryFn: () => listRatingTasks(q),
    placeholderData: (prev) => prev,
    refetchInterval: (query) => {
      const live = (query.state.data?.list ?? []).some(
        (t) => t.status === 'running' || t.status === 'waiting',
      );
      return live ? 30_000 : false;
    },
  });
}

export function useRatingTaskInfo(taskId: string) {
  return useQuery({
    queryKey: ['rating-task-info', taskId],
    queryFn: () => getRatingTaskInfo(taskId),
    enabled: !!taskId,
    staleTime: 30_000,
  });
}

export function useRenameRatingTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name: string }) => renameRatingTask(v.id, v.name),
    onSuccess: async (_, { id, name }) => {
      await qc.cancelQueries({ queryKey: ['rating-task-info', id] });
      qc.setQueryData<RatingTask | null>(['rating-task-info', id], (task) =>
        task ? { ...task, name } : task,
      );
      qc.setQueriesData<PageResult<RatingTask>>({ queryKey: ['rating-tasks'] }, (data) =>
        data
          ? {
              ...data,
              list: data.list?.map((task) => (task._id === id ? { ...task, name } : task)),
            }
          : data,
      );
      return qc.invalidateQueries({ queryKey: ['rating-tasks'] });
    },
  });
}

export function useDeleteRatingTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteRatingTasks,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rating-tasks'] }),
  });
}

export function useControlRatingTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: RatingAction; taskId: string }) =>
      controlRatingTask(v.action, v.taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rating-tasks'] }),
  });
}

export function useRatingResults(q: RatingResultQuery, enabled = true) {
  return useQuery({
    queryKey: ['rating-results', q],
    queryFn: () => listRatingResults(q),
    enabled: enabled && !!q.taskId,
    placeholderData: (prev) => prev,
  });
}

export function useRatingReport(chatId: string) {
  return useQuery({
    queryKey: ['rating-report', chatId],
    queryFn: () => getRatingReport(chatId),
    enabled: !!chatId,
    // 报告是一次性生成的,不会变,缓存久一点
    staleTime: 10 * 60_000,
  });
}

/* ---------- 邮件营销 ---------- */

export function useMassTasks(q: MassListQuery) {
  return useQuery({
    queryKey: ['mass-tasks', q],
    queryFn: () => listMassTasks(q),
    placeholderData: (prev) => prev,
    // 老项目是 30 秒无条件常开(连进了详情页都还在轮)。
    // 这里只在真有任务在跑时轮询,列表全是终态就停
    refetchInterval: (query) => (massTaskLive(query.state.data?.list ?? []) ? 30_000 : false),
  });
}

export function useMassTaskCounts() {
  return useQuery({
    queryKey: ['mass-task-counts'],
    queryFn: massTaskCounts,
    staleTime: 30_000,
  });
}

export function useMassTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: MassAction; gtid: string }) => massTaskAction(v.action, v.gtid),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['mass-tasks'] }),
        qc.invalidateQueries({ queryKey: ['mass-task-counts'] }),
      ]),
  });
}

export function useMassTaskBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: MassRemovalAction; gtids: string[] }) =>
      massTaskBulk(v.action, v.gtids),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['mass-tasks'] }),
        qc.invalidateQueries({ queryKey: ['mass-task-counts'] }),
      ]),
  });
}

export function useRenameMassTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { gtid: string; name: string }) => renameMassTask(v.gtid, v.name),
    onSuccess: (_, { gtid }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['mass-tasks'] }),
        qc.invalidateQueries({ queryKey: ['mass-detail', gtid] }),
      ]),
  });
}

export function useTracks(q: TrackListQuery) {
  return useQuery({
    queryKey: ['tracks', q],
    queryFn: () => listTracks(q),
    placeholderData: (prev) => prev,
  });
}

export function useSequences(q: SeqListQuery) {
  return useQuery({
    queryKey: ['sequences', q],
    queryFn: () => listSequences(q),
    placeholderData: (prev) => prev,
  });
}

export function useSequenceAction() {
  const qc = useQueryClient();
  // 列表读回新状态后才结束 pending，避免用旧状态再次启停。
  const done = () => qc.invalidateQueries({ queryKey: ['sequences'] });
  return {
    setActive: useMutation({
      mutationFn: (v: { id: string; active: boolean }) => setSequenceActive(v.id, v.active),
      onSuccess: done,
    }),
    copy: useMutation({ mutationFn: copySequence, onSuccess: done }),
    remove: useMutation({ mutationFn: deleteSequence, onSuccess: done }),
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) => renameSequence(v.id, v.name),
      onSuccess: done,
    }),
  };
}
