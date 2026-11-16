import { postEnvelope } from '@/api/auth';

const authorizationErrors = { readErrorMessage: true };

export interface AuthorizationInfo {
  clientName: string;
  userCode: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  expiresAt: number;
  tokenLifetimeDays: number;
  authorizedWorkspaceName?: string;
  scope: string;
  account: { name: string };
  workspaces: { uid: string; name: string; isOrg: boolean }[];
}
export type AuthorizationGrantStatus = 'active' | 'expired' | 'revoked';

export interface AuthorizedApp {
  id: string;
  clientName: string;
  workspaceId: string;
  workspaceName: string;
  createdAt: number;
  expiresAt: number;
  status: AuthorizationGrantStatus;
  revokedAt: number | null;
}
export const getAuthorizationInfo = (userCode: string) =>
  postEnvelope<AuthorizationInfo>('/oauth/device/info', { userCode }, authorizationErrors);
export const decideAuthorization = (userCode: string, approve: boolean, workspaceId?: string) =>
  postEnvelope<{ status: 'approved' | 'denied' }>(
    '/oauth/device/decision',
    {
      userCode,
      approve,
      workspaceId,
    },
    authorizationErrors,
  );
export const listAuthorizedApps = () =>
  postEnvelope<AuthorizedApp[]>('/oauth/grants/list', {}, authorizationErrors);
export const revokeAuthorizedApp = (id: string) =>
  postEnvelope<{ revoked: boolean }>('/oauth/grants/revoke', { id }, authorizationErrors);
