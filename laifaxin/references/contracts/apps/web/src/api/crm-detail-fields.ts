import { postEnvelope } from '@/api/auth';
import { companyFields } from '@/api/crm-company';

export type DetailFieldType = 'contacts' | 'company';

export async function getDetailFieldIndices(belongTo: DetailFieldType) {
  const columns = await postEnvelope<string[]>('/fields/field-index-list', {
    belongTo,
    saveType: 'update',
  });
  return belongTo === 'company'
    ? companyFields(columns.map((dataIndex) => ({ dataIndex }))).map((f) => f.dataIndex as string)
    : columns;
}

export const saveDetailFieldIndices = (belongTo: DetailFieldType, columns: string[]) =>
  postEnvelope<unknown>('/fields/save-columns-config', { belongTo, saveType: 'update', columns });

export const resetDetailFieldIndices = (belongTo: DetailFieldType) =>
  postEnvelope<unknown>('/fields/delete-columns-config', { belongTo, saveType: 'update' });
