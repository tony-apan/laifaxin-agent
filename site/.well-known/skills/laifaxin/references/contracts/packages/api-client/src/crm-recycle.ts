import type { RecycleRestoreProgress } from '@laifaxin/core/crm-recycle';
import type { ApiClient } from './client';

export function createCrmRecycleApi(client: Pick<ApiClient, 'postEnvelope'>) {
  const { postEnvelope } = client;
  const getRestoreProgress = (id: string) =>
    postEnvelope<RecycleRestoreProgress | null>('/operation/backend-progress', { id });
  return { getRestoreProgress };
}
