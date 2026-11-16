import { z } from 'zod';
import { postEnvelope, postEnvelopeFull } from './auth';

export const NOTICE_TYPES = [
  'service',
  'activity',
  'payment',
  'task',
  'partner',
  'security',
] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];
export type NoticeFilter = 'all' | NoticeType;
export const notificationsSearchSchema = z.object({
  type: z.enum(['all', ...NOTICE_TYPES]).catch('all'),
});

const messageSchema = z.object({
  _id: z.string().min(1),
  title: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  type: z
    .string()
    .nullish()
    .transform((value) => value ?? 'service'),
  status: z.coerce.number().default(0),
  create_time: z.coerce.number().nullish(),
  content: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
});
export type NotificationMessage = z.infer<typeof messageSchema>;
export interface MessageList {
  list: NotificationMessage[];
  total: number;
}

/** 列表的 total 位于信封顶层；详情请求会由服务端自动标记已读。 */
export async function listMessages(
  type: NoticeFilter,
  current: number,
  pageSize: number,
): Promise<MessageList> {
  const result = await postEnvelopeFull<unknown>('/notifications/messages/show', {
    current,
    pageSize,
    filter: type === 'all' ? {} : { type },
    sort: { create_time: -1 },
  });
  return {
    list: z.array(messageSchema).parse(result.data),
    total: z.coerce.number().int().nonnegative().parse(result.total),
  };
}

export async function getMessage(msgId: string): Promise<NotificationMessage | null> {
  const data = await postEnvelope<unknown>('/notifications/message-details', { msgId });
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
  return messageSchema.parse(data);
}

function messageIds(ids: string[]) {
  return z
    .array(z.string().min(1))
    .min(1)
    .parse([...new Set(ids)]);
}
export const markMessagesRead = (type: NoticeFilter, ids: string[]) =>
  postEnvelope<unknown>('/notifications/messages-read', { type, msgIds: messageIds(ids) });
export const deleteMessages = (type: NoticeFilter, ids: string[]) =>
  postEnvelope<unknown>('/notifications/messages-delete', { type, msgIds: messageIds(ids) });
