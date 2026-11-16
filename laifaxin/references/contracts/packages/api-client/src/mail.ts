import type { CancellationCheck } from '@laifaxin/core/common';
import {
  escapeRegExp,
  type MailDetail,
  type MailListQuery,
  type MailListResult,
  type MailNode,
  type MailRow,
  type MailScope,
  mailListBody,
} from '@laifaxin/core/mail';
import type { ApiClient } from './client';

/** Shared Web contract. Mobile always supplies one explicit ID and selectOption=current. */
export function createMailReadApi(client: Pick<ApiClient, 'postEnvelope'>) {
  return {
    markMailsSeen: (scope: MailScope) => client.postEnvelope('/mails/mails-mark-seen', scope),
    markMailsUnseen: (scope: MailScope) => client.postEnvelope('/mails/mails-mark-unseen', scope),
    async findMail(
      target: MailRow,
      signal?: CancellationCheck,
      acrossFolders = false,
    ): Promise<MailRow> {
      if (!target._id || !target.maid || !target.boxName) throw new Error('mail.notFound');
      // mail-open changes unread status. Verify through the read-only list instead.
      // The legacy list has no ID filter. Narrow by mailbox/subject, then compare exact IDs.
      for (let current = 1; current <= 10; current++) {
        signal?.throwIfAborted();
        const result = await client.postEnvelope<MailListResult>('/mails/mails-list', {
          current,
          pageSize: 100,
          sort: { timestamp: -1, _id: -1 },
          owners: [],
          filter: {
            maid: target.maid,
            parent: acrossFolders ? '/' : (target.parent ?? ''),
            ...(acrossFolders ? {} : { boxName: target.boxName }),
            keyword: escapeRegExp(
              (typeof target.subject === 'string' ? target.subject : '').slice(0, 256),
            ),
          },
        });
        signal?.throwIfAborted();
        if (!Array.isArray(result?.list) || !Number.isSafeInteger(result.total) || result.total < 0)
          throw new Error('mail.invalidResponse');
        const mail = result.list.find((row) => row._id === target._id && row.maid === target.maid);
        if (mail) return mail;
        if (!result.list.length || current * 100 >= result.total) throw new Error('mail.notFound');
      }
      throw new Error('mail.readVerifyFailed');
    },
  };
}

/** Move to the mailbox's Deleted folder; never calls permanent deletion endpoints. */
export function createMailTrashApi(client: Pick<ApiClient, 'postEnvelope'>) {
  return {
    deleteMails: (scope: MailScope) =>
      client
        .postEnvelope<{ deletedCount?: unknown; totalCount?: unknown } | undefined>(
          '/mails/mails-delete',
          scope,
        )
        .then((result) => {
          const count = result?.deletedCount;
          if (count && typeof count === 'object' && 'success' in count && count.success === false) {
            throw new Error(
              'message' in count && typeof count.message === 'string' ? count.message : '删除失败',
            );
          }
          return result;
        }),
  };
}

/** Caller must enforce same mailbox/parent and verify the destination by reading the list. */
export function createMailMoveApi(client: Pick<ApiClient, 'postEnvelope'>) {
  return {
    moveMail: (id: string, boxName: string) =>
      client.postEnvelope('/mails/mail-move', { id, boxName }),
  };
}

/** Reading a detail follows the existing server contract: unread mail becomes read. */
export function createMailApi(client: Pick<ApiClient, 'postEnvelope'>, strict = false) {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    async listMailAccounts(owners: string[] = []): Promise<MailNode[]> {
      const data = await client.postEnvelope<MailNode[] | undefined>('/mails/accounts-list', {
        owners,
      });
      if (strict && !Array.isArray(data)) throw new Error('mail.invalidResponse');
      return data ?? [];
    },
    async listMails(query: MailListQuery): Promise<MailListResult> {
      const data = await client.postEnvelope<Partial<MailListResult> | undefined>(
        '/mails/mails-list',
        mailListBody(query),
      );
      if (
        strict &&
        (!Array.isArray(data?.list) ||
          typeof data?.total !== 'number' ||
          !Number.isFinite(data.total) ||
          data.total < 0 ||
          data.list.some((row) => !row || typeof row._id !== 'string' || !row._id))
      ) {
        throw new Error('mail.invalidResponse');
      }
      return {
        list: Array.isArray(data?.list) ? data.list : [],
        total: num(data?.total),
        unseen: num(data?.unseen),
        storeUrl: data?.storeUrl,
        trackUrl: data?.trackUrl,
      };
    },
    async openMail(id: string): Promise<MailDetail | null> {
      const data = await client.postEnvelope<MailDetail | null | undefined>('/mails/mail-open', {
        id,
      });
      if (strict && data != null && (typeof data._id !== 'string' || data._id !== id))
        throw new Error('mail.invalidResponse');
      return data ?? null;
    },
  };
}
