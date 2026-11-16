import { createAccountApi } from '@laifaxin/api-client/account';
import { postEnvelope } from './auth';

export {
  ACCOUNT_ENDPOINTS,
  type AccountCurrent,
  accountDisplayName,
  type VipExpiry,
  vipExpiry,
} from '@laifaxin/core/account';

export const { getAccountCurrent } = createAccountApi({ postEnvelope });
