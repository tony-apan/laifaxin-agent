import type { ContactRow, ListResult } from '@laifaxin/core/crm';
import type { ApiClient } from './client';

export function createCrmContactApi(client: Pick<ApiClient, 'postEnvelope'>) {
  const { postEnvelope } = client;
  const createContact = (values: Record<string, unknown>) =>
    postEnvelope<ContactRow | undefined>('/contacts/contact/add', values);

  // The legacy create endpoint returns no cid. Resolve by exact email, never by a fuzzy match.
  const findContactByEmail = async (email: string) => {
    const result = await postEnvelope<ListResult<ContactRow>>('/contacts/contacts/show', {
      viewId: 'all',
      keyword: '',
      logic: 'and',
      current: 1,
      pageSize: 10, // Backend list DTO requires at least 10, even for an exact match.
      filters: [{ property: 'email', operator: 'eq', value: email, valueType: 'text' }],
      sort: { create_time: -1, _id: -1 },
    });
    if (
      !result ||
      !Array.isArray(result.list) ||
      typeof result.total !== 'number' ||
      !Number.isInteger(result.total) ||
      result.total < 0
    )
      throw new Error('customers.invalidResponse');
    if (result.total === 0 && result.list.length === 0) return null;
    if (
      result.total !== 1 ||
      result.list.length !== 1 ||
      !result.list[0].cid ||
      result.list[0].email !== email
    )
      throw new Error('customers.invalidResponse');
    return result.list[0];
  };

  const getContactCreateFields = () =>
    postEnvelope<string[]>('/fields/field-index-list', {
      belongTo: 'contacts',
      saveType: 'create',
    });

  const saveContactCreateFields = (columns: string[]) =>
    postEnvelope<unknown>('/fields/save-columns-config', {
      belongTo: 'contacts',
      saveType: 'create',
      columns,
    });

  /** 列表显示配置与创建、详情配置使用独立的 show 作用域。 */
  const getContactListFields = () =>
    postEnvelope<string[]>('/fields/field-index-list', { belongTo: 'contacts', saveType: 'show' });

  const saveContactListFields = (columns: string[]) =>
    postEnvelope<unknown>('/fields/save-columns-config', {
      belongTo: 'contacts',
      saveType: 'show',
      columns,
    });

  const resetContactListFields = () =>
    postEnvelope<unknown>('/fields/delete-columns-config', {
      belongTo: 'contacts',
      saveType: 'show',
    });

  /** 旧接口支持一次保存多个字段，成功响应不带联系人资料。 */
  const saveContact = (body: Record<string, unknown> & { cid: string }) =>
    postEnvelope<unknown>('/contacts/contact/save', body);
  return {
    createContact,
    findContactByEmail,
    getContactCreateFields,
    saveContactCreateFields,
    getContactListFields,
    saveContactListFields,
    resetContactListFields,
    saveContact,
  };
}
