import { createCrmCompanyApi } from '@laifaxin/api-client/crm-company';
import { companyCreateBody as prepareCompanyInput } from '@laifaxin/core/crm-company';
import { postEnvelope } from './auth';

export { companyFields } from '@laifaxin/core/crm-company';

import { countryByCode } from '@/data/countries';
/** 允许粘贴官网地址，提交旧接口要求的裸域名。 */
export function companyDomain(value: string): string | null {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)
      ? host
      : null;
  } catch {
    return null;
  }
}

export const companyCreateBody = (values: Record<string, unknown>) =>
  prepareCompanyInput(values, {
    parseDomain: companyDomain,
    findCountry: (code) => countryByCode.get(code),
  });

const companyApi = createCrmCompanyApi({ postEnvelope });
export const createCompany = (values: Record<string, unknown>) =>
  companyApi.createCompany(companyCreateBody(values));
export const {
  getCompanyCreateFields,
  saveCompanyCreateFields,
  getCompanyListFields,
  saveCompanyListFields,
  resetCompanyListFields,
  getCrmCompany,
  getCompanyContacts,
  saveCrmCompany,
} = companyApi;
