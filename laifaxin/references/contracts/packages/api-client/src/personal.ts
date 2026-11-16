import type { PersonalInfo } from '@laifaxin/core/personal';
import type { ApiClient } from './client';

export function createPersonalApi({ postEnvelope }: Pick<ApiClient, 'postEnvelope'>) {
  return {
    getPersonalInfo: () => postEnvelope<PersonalInfo>('/account/info', {}),
    saveProfile: (patch: {nickname?: string; avatarUrl?: string}) => postEnvelope<void>('/account/info-save', {...patch}),
    logout: () => postEnvelope<unknown>('/account/logout', {}),
  };
}
