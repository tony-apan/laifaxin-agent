import { postEnvelope } from './auth';

export interface ContactDevelopmentRecord {
  _id: string;
  gtid?: string;
  sid?: string;
  to?: string;
  channel?: number;
  subject?: string;
  status?: string;
  error?: string;
  reason?: string;
  create_time?: number;
  read_num?: number;
  read_time?: number;
  click_num?: number;
  click_time?: number;
  htmlId?: string;
  html?: string;
}

export const DEVELOPMENT_SORT_FIELDS = [
  'subject',
  'read_num',
  'click_num',
  'create_time',
  'error',
] as const;
export type DevelopmentSortField = (typeof DEVELOPMENT_SORT_FIELDS)[number];

/** 开发记录按联系人 cid 查询；邮件往来则按 email 查询，两者不能混用。 */
export async function listContactDevelopment(q: {
  cid: string;
  current: number;
  pageSize: number;
  sort: Partial<Record<DevelopmentSortField, 1 | -1>>;
}) {
  const result = await postEnvelope<
    | {
        list?: ContactDevelopmentRecord[];
        total?: number;
      }
    | undefined
  >('/mails/dev-history-list', {
    current: q.current,
    pageSize: q.pageSize,
    sort: q.sort,
    filter: { cid: q.cid },
  });
  return {
    list: Array.isArray(result?.list) ? result.list : [],
    total: Math.max(0, Number(result?.total) || 0),
  };
}
