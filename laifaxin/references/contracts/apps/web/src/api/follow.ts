import { createFollowApi } from '@laifaxin/api-client/follow';
import { postEnvelope } from './auth';

export {
  defaultTaskTime,
  draftFromRecord,
  emptyFollowDraft,
  FOLLOW_TYPES,
  type FollowAttachment,
  type FollowDraft,
  type FollowQuery,
  type FollowRecord,
  type FollowType,
  followBody,
  groupByTime,
  hasPendingImage,
  isFollowType,
  type Relation,
  TASK_PRESETS,
  TASK_TYPES,
  type TaskType,
  toRelations,
  validateFollow,
} from '@laifaxin/core/follow';

export const {
  searchContacts,
  searchCompanies,
  listFollowRecords,
  deleteFollowRecord,
  addFollowRecord,
  saveFollowRecord,
} = createFollowApi({ postEnvelope });
