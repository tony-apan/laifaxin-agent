import { ACCOUNT_ENDPOINTS, type AccountCurrent } from '@laifaxin/core/account';
import type { ApiClient } from './client';

export function createAccountApi(client: Pick<ApiClient, 'postEnvelope'>) {
  const { postEnvelope } = client;
  const getAccountCurrent = () => postEnvelope<AccountCurrent>(ACCOUNT_ENDPOINTS.current, {});
  return { getAccountCurrent };
}
