import type { CancellationCheck } from '@laifaxin/core/common';
import {
  FOLLOW_TYPES,
  type FollowDraft,
  type FollowQuery,
  followBody,
  num,
  type Relation,
  str,
  toRecord,
} from '@laifaxin/core/follow';
import type { PageResult } from '@laifaxin/core/pagination';
import type { ApiClient } from './client';

export function createFollowApi(client: Pick<ApiClient, 'postEnvelope'>) {
  const { postEnvelope } = client;
  const searchContacts = (keyword: string) =>
    postEnvelope<Record<string, unknown>[] | undefined>('/contacts/people-search', {
      keyword,
    }).then((r) =>
      (r ?? []).map(
        (x): Relation => ({ kind: 'contact', id: str(x.cid), label: str(x.email) || str(x.cid) }),
      ),
    );

  const searchCompanies = (keyword: string) =>
    postEnvelope<Record<string, unknown>[] | undefined>('/contacts/company-search', {
      keyword,
    }).then((r) =>
      (r ?? []).map(
        (x): Relation => ({
          kind: 'company',
          id: str(x._id),
          label: str(x.orgName) || str(x.domain) || str(x._id),
        }),
      ),
    );

  const listFollowRecords = (q: FollowQuery) =>
    postEnvelope<PageResult<Record<string, unknown>> | undefined>('/record/log-list', {
      current: q.current,
      pageSize: q.pageSize,
      keyword: q.keyword.trim(),
      sort: { create_time: -1 as const },
      filter: {
        // 这两个在**列表接口里是单个字符串**,提交接口里才是数组
        ...(q.subject.kind === 'contact'
          ? { contactIds: q.subject.id }
          : { companyIds: q.subject.id }),
        // The backend uses this array as a type match, so [] matches nothing.
        // Expand the UI's “all” selection like the legacy project does.
        type: q.types.length ? q.types : [...FOLLOW_TYPES],
      },
    }).then((r) => ({
      list: (r?.list ?? []).map(toRecord),
      total: num(r?.total),
    }));

  const deleteFollowRecord = (id: string) => postEnvelope<unknown>('/record/log-delete', { id });

  const addFollowRecord = (d: FollowDraft) =>
    postEnvelope<unknown>('/record/log-add', followBody(d));

  // log-add returns no ID. Its exact client timestamp survives on the log. The
  // generated task instead carries the same HTML, contact, author and due time.
  async function verifyAddedFollow(
    d: FollowDraft,
    userId: string | undefined,
    signal: CancellationCheck,
  ) {
    const cid = d.relations.find((r) => r.kind === 'contact')?.id;
    if (!cid) return false;
    const logs = (filter: Record<string, unknown>) => {
      signal.throwIfAborted();
      return postEnvelope<PageResult<Record<string, unknown>>>('/record/log-list', {
        current: 1,
        pageSize: 2,
        keyword: '',
        sort: { create_time: 1 },
        filter: { contactIds: cid, type: [d.type], ...filter },
      });
    };
    const result = await logs({ timestamp: d.timestamp, ...(userId && { userid: userId }) });
    signal.throwIfAborted();
    const row = result?.list?.[0];
    if (
      result?.total !== 1 ||
      !row ||
      !str(row._id) ||
      row.type !== d.type ||
      num(row.timestamp) !== d.timestamp ||
      row.body !== d.body ||
      !Array.isArray(row.contactIds) ||
      !row.contactIds.includes(cid) ||
      (userId && row.userid !== userId) ||
      num(row.taskTime) !== (d.taskCreate ? d.taskTime : 0)
    )
      return false;
    if (!d.taskCreate) return true;
    const author = str(row.userid),
      created = num(row.create_time);
    if (!author || !created) return false;
    const tasks = await postEnvelope<PageResult<Record<string, unknown>>>('/record/task-list', {
      current: 1,
      pageSize: 2,
      viewId: 'all',
      filter: {},
      keyword: '',
      logic: 'and',
      sort: { create_time: 1, _id: 1 },
      filters: [
        { property: 'contactIds', valueType: 'select', operator: 'include', values: [cid] },
        { property: 'type', valueType: 'text', operator: 'eq', value: d.taskType },
        { property: 'creator', valueType: 'text', operator: 'eq', value: author },
        { property: 'timestamp', valueType: 'digit', operator: 'eq', value: d.taskTime },
        { property: 'body', valueType: 'text', operator: 'eq', value: d.body },
        { property: 'create_time', valueType: 'digit', operator: 'gte', value: created },
      ],
    });
    signal.throwIfAborted();
    const task = tasks?.list?.[0];
    if (
      tasks?.total !== 1 ||
      !task ||
      !str(task._id) ||
      task.type !== d.taskType ||
      task.creator !== author ||
      task.body !== d.body ||
      num(task.timestamp) !== d.taskTime ||
      num(task.create_time) < created ||
      !Array.isArray(task.contactIds) ||
      !task.contactIds.includes(cid)
    )
      return false;
    // There is no task → log foreign key. Another identical scheduled note
    // written before the task could be its source. Keep ambiguous results pending.
    const candidates = await logs({
      userid: author,
      body: d.body,
      taskType: d.taskType,
      taskTime: d.taskTime,
      create_time: { $lte: num(task.create_time) },
    });
    signal.throwIfAborted();
    return candidates?.total === 1 && candidates.list?.[0]?._id === row._id;
  }

  const saveFollowRecord = (d: FollowDraft) =>
    postEnvelope<unknown>('/record/log-save', followBody(d));
  return {
    searchContacts,
    searchCompanies,
    listFollowRecords,
    deleteFollowRecord,
    addFollowRecord,
    verifyAddedFollow,
    saveFollowRecord,
  };
}
