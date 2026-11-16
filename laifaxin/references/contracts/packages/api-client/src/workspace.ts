import { normalizeWorkspace, type Workspace } from '@laifaxin/core/workspace';
import type { ApiClient } from './client';

export function createWorkspaceApi({ postEnvelope }: Pick<ApiClient, 'postEnvelope'>) {
  return {
    async listWorkspaces(): Promise<Workspace[]> {
      const raw = await postEnvelope<Record<string, unknown>[] | undefined>(
        '/enterprise/my-organies',
        {},
      );
      return (Array.isArray(raw) ? raw : [])
        .map(normalizeWorkspace)
        .filter((w) => !w.isOrg || w.status !== 'exiting');
    },
    saveCurrentOrg: (orgId: string) => postEnvelope<unknown>('/account/save-config', { orgId }),
  };
}
