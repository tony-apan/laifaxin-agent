import { type FieldDraft, type FieldOwner, fieldBody, toRow } from '@laifaxin/core/fields';
import type { ApiClient } from './client';

export function createFieldsApi(client: Pick<ApiClient, 'postEnvelope'>) {
  const { postEnvelope } = client;
  /** 一次拉全部,两种 belongTo 混在一起。没有分页、没有请求体 */
  const listAllFields = () =>
    postEnvelope<Record<string, unknown>[] | undefined>('/settings/fields/show', {}).then((r) =>
      (r ?? []).map(toRow),
    );

  const createField = (d: FieldDraft) =>
    postEnvelope<unknown>('/fields/field/create', fieldBody(d));

  const updateField = (d: FieldDraft) =>
    postEnvelope<unknown>('/fields/field/update', fieldBody(d));

  const deleteField = (f: { belongTo: FieldOwner; dataIndex: string }) =>
    postEnvelope<unknown>('/fields/field/delete', {
      belongTo: f.belongTo,
      dataIndex: f.dataIndex,
    });
  return { listAllFields, createField, updateField, deleteField };
}
