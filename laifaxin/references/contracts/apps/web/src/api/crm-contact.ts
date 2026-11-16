import { createCrmContactApi } from '@laifaxin/api-client/crm-contact';
import { postEnvelope } from './auth';

export const {
  createContact,
  getContactCreateFields,
  saveContactCreateFields,
  getContactListFields,
  saveContactListFields,
  resetContactListFields,
  saveContact,
} = createCrmContactApi({ postEnvelope });
