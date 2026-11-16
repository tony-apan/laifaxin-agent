import { createFieldsApi } from '@laifaxin/api-client/fields';
import { postEnvelope } from './auth';

export {
  canDeleteField,
  canEditField,
  draftFromField,
  emptyField,
  FIELD_OWNERS,
  FIELD_TITLE_MAX,
  type FieldDraft,
  type FieldOptionItem,
  type FieldOwner,
  type FieldRow,
  fieldBody,
  fieldKey,
  hasOptions,
  isValueType,
  titleTaken,
  VALUE_TYPES,
  type ValueType,
  validateField,
} from '@laifaxin/core/fields';

export const { listAllFields, createField, updateField, deleteField } = createFieldsApi({
  postEnvelope,
});
