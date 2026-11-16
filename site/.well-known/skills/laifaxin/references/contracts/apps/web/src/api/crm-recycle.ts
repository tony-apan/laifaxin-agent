import { createCrmRecycleApi } from '@laifaxin/api-client/crm-recycle';
import { postEnvelope } from './auth';

export {
  companyRecycleSort,
  RECYCLE_TIME_PRESETS,
  type RecycleFilter,
  type RecycleKind,
  type RecycleRestoreProgress,
} from '@laifaxin/core/crm-recycle';

import { recycleFilter as coreRecycleFilter } from '@laifaxin/core/crm-recycle';
import i18n from 'i18next';
export const recycleFilter = (...[query, kind]: Parameters<typeof coreRecycleFilter>) =>
  coreRecycleFilter(
    query,
    kind,
    i18n.t(
      kind === 'contacts' ? 'recycle.contactFilterUnsupported' : 'recycle.companyFilterUnsupported',
      { ns: 'crm' },
    ),
  );
export const RESTORE_QUERY_KEYS = [
  'crm-recycle',
  'crm-companies',
  'crm-company',
  'company-detail',
  'crm-contacts',
  'crm-contact',
  'email-contact',
  'relation-search',
];
export const { getRestoreProgress } = createCrmRecycleApi({ postEnvelope });
