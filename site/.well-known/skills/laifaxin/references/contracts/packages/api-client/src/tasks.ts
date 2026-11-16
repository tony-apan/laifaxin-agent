import type { CancellationCheck } from '@laifaxin/core/common';
import type { BaseParams, ListQuery } from '@laifaxin/core/crm';
import type { Relation } from '@laifaxin/core/follow';
import {
  num,
  type Task,
  type TaskDraft,
  type TaskStatus,
  taskBody,
  toTask,
} from '@laifaxin/core/tasks';
import type { ApiClient } from './client';

export function createTasksApi(
  client: Pick<ApiClient, 'postEnvelope'>,
  getNotFoundMessage: () => string = () => 'tk.notFound',
) {
  const { postEnvelope } = client;
  /** 客户管理任务列表使用分页接口;日历接口最多返回 1000 条,不能代替它。 */
  const listCrmTasks = async (q: ListQuery) => {
    const data = await postEnvelope<{
      list?: Record<string, unknown>[];
      total?: number;
      current?: number;
    }>('/record/task-list', { ...q, viewId: 'all', filter: {} });
    return {
      list: (data?.list ?? []).map(toTask),
      total: num(data?.total),
      current: num(data?.current, q.current),
    };
  };

  /**
   * 合并后的月历与列表共用查询。旧 calendar-task-list 不支持筛选且截断为 1000 条。
   * 后端不支持嵌套逻辑,直接追加日期条件会破坏 OR 视图,因此保留原查询逐页读取,
   * 由月历按真实起止时间取交集。任务列表 DTO 每页最多 100 条，不能使用日历服务的 1000 条上限。
   * 结果按筛选缓存,切月不必重新拉取全部任务。
   */
  async function listCrmCalendarTasks(
    q: Pick<ListQuery, 'keyword' | 'filters' | 'logic'>,
    signal?: CancellationCheck,
  ): Promise<Task[]> {
    const tasks = new Map<string, Task>();
    let loaded = 0;
    let total = Number.POSITIVE_INFINITY;
    for (let current = 1; loaded < total; current++) {
      signal?.throwIfAborted();
      const page = await listCrmTasks({ ...q, current, pageSize: 100, sort: { _id: 1 } });
      signal?.throwIfAborted();
      if (current === 1) total = page.total;
      if (!page.list.length && loaded < total) throw new Error('Incomplete task response');
      const previousSize = tasks.size;
      for (const task of page.list) tasks.set(task.id, task);
      if (page.list.length && tasks.size === previousSize) throw new Error('Repeated task page');
      loaded += page.list.length;
    }
    return [...tasks.values()];
  }

  /** 下一步跟进取关联客户最早的未完成任务，逾期任务仍需处理。 */
  async function getNextFollowTask(
    subject: Relation,
    signal?: CancellationCheck,
  ): Promise<Task | null> {
    const property = subject.kind === 'contact' ? 'contactIds' : 'companyIds';
    const tasks = await listCrmCalendarTasks(
      {
        keyword: '',
        logic: 'and',
        filters: [
          { property, valueType: 'select', operator: 'include', values: [subject.id] },
          {
            property: 'status',
            valueType: 'select',
            operator: 'exclude',
            values: ['finished', 'canceled'],
          },
        ],
      },
      signal,
    );
    return (
      tasks
        .filter((task) => task[property].includes(subject.id) && !task.status && task.start > 0)
        .sort((a, b) => a.start - b.start)[0] ?? null
    );
  }

  const deleteCrmTasks = (params: BaseParams) =>
    postEnvelope<unknown>('/record/tasks-delete', { ...params, viewId: 'all', filter: {} });

  /** 编辑前读取最新任务，避免列表快照覆盖更新后的客户关联。 */
  async function getTask(id: string): Promise<Task> {
    const record = await postEnvelope<Record<string, unknown> | undefined>('/record/task-info', {
      id,
    });
    const task = toTask(record ?? {});
    if (!task.id) throw new Error(getNotFoundMessage());
    return task;
  }

  const addTask = (d: TaskDraft) => postEnvelope<unknown>('/record/task-add', taskBody(d));

  const saveTask = (d: TaskDraft) =>
    postEnvelope<unknown>('/record/task-save', { ...taskBody(d), id: d.id });

  const deleteTask = (id: string) => postEnvelope<unknown>('/record/task-delete', { id });

  /** 勾完成 / 取消完成 */
  const setTaskStatus = (id: string, status: TaskStatus, title: string) =>
    // TaskUpdateInput 继承新增 DTO,标题仍是必填,只发 id/status 会被真实后端拒绝。
    postEnvelope<unknown>('/record/task-save', { id, title, status });
  return {
    listCrmTasks,
    listCrmCalendarTasks,
    getNextFollowTask,
    deleteCrmTasks,
    getTask,
    addTask,
    saveTask,
    deleteTask,
    setTaskStatus,
  };
}
