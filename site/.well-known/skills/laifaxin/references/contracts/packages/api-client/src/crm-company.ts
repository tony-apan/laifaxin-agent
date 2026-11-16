import type { CompanyRow, ContactRow } from '@laifaxin/core/crm';
import { companyFields } from '@laifaxin/core/crm-company';
import type { PageResult } from '@laifaxin/core/pagination';
import type { ApiClient } from './client';

export function createCrmCompanyApi(client: Pick<ApiClient, 'postEnvelope'>) {
  const { postEnvelope } = client;
  const createCompany = (values: Record<string, unknown>) =>
    postEnvelope<CompanyRow | undefined>('/contacts/company/add', values);

  const getCompanyCreateFields = async () => {
    const columns = await postEnvelope<string[]>('/fields/field-index-list', {
      belongTo: 'company',
      saveType: 'create',
    });
    return companyFields(columns.map((dataIndex) => ({ dataIndex }))).map(
      (f) => f.dataIndex as string,
    );
  };

  const saveCompanyCreateFields = (columns: string[]) =>
    postEnvelope<unknown>('/fields/save-columns-config', {
      belongTo: 'company',
      saveType: 'create',
      columns,
    });

  const getCompanyListFields = async () => {
    const columns = await postEnvelope<string[]>('/fields/field-index-list', {
      belongTo: 'company',
      saveType: 'show',
    });
    return companyFields(columns.map((dataIndex) => ({ dataIndex }))).map(
      (field) => field.dataIndex as string,
    );
  };

  const saveCompanyListFields = (columns: string[]) =>
    postEnvelope<unknown>('/fields/save-columns-config', {
      belongTo: 'company',
      saveType: 'show',
      columns,
    });

  const resetCompanyListFields = () =>
    postEnvelope<unknown>('/fields/delete-columns-config', {
      belongTo: 'company',
      saveType: 'show',
    });

  /** 客户管理里的公司资料，以客户公司 ID 查询，包含用户自定义字段。 */
  const getCrmCompany = (id: string) =>
    postEnvelope<CompanyRow | null | undefined>('/contacts/company-info', { id }).then(
      (company) => company ?? null,
    );

  /** 已保存到客户管理且关联此公司的联系人；使用客户公司 _id，不使用域名。 */
  const getCompanyContacts = async (id: string, current: number, pageSize = 10) => {
    const data = await postEnvelope<PageResult<ContactRow> | undefined>(
      '/contacts/company-people',
      {
        id,
        current,
        pageSize,
      },
    );
    return { list: data?.list ?? [], total: data?.total ?? 0 };
  };

  /** 单个客户公司保存；后端只返回 success，不返回更新后的记录。 */
  const saveCrmCompany = (body: Record<string, unknown> & { id: string }) =>
    postEnvelope<unknown>('/contacts/company/save', body);
  return {
    createCompany,
    getCompanyCreateFields,
    saveCompanyCreateFields,
    getCompanyListFields,
    saveCompanyListFields,
    resetCompanyListFields,
    getCrmCompany,
    getCompanyContacts,
    saveCrmCompany,
  };
}
