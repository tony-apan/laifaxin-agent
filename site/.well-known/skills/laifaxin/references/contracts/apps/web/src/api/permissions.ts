import { createPermissionsApi } from '@laifaxin/api-client/permissions';
import { postEnvelope } from './auth';

export {
  allows,
  EMPTY_PERMISSIONS,
  type MyPermissions,
  normalizePermissions,
  PERM,
  type PermKey,
  permKeyOf,
} from '@laifaxin/core/permissions';

export const { getMyPermissions } = createPermissionsApi({ postEnvelope });
