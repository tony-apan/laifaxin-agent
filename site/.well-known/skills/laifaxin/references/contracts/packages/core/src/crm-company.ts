import type { FieldItem } from './crm';

/** 列表的历史别名不适用于新建和文件导入接口。 */
export function companyFields(fields: FieldItem[]): FieldItem[] {
  const seen = new Set<string>();
  return fields.flatMap((field) => {
    const key =
      field.dataIndex === 'name'
        ? 'orgName'
        : field.dataIndex === 'country_code'
          ? 'countryCode'
          : field.dataIndex;
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ ...field, dataIndex: key }];
  });
}

/** URL parsing and country catalogs are supplied by the application. */
export interface CompanyInputAdapters {
  parseDomain(value: string): string | null;
  findCountry(code: string): { abb2: string; en: string } | undefined;
}

export function companyCreateBody(values: Record<string, unknown>, adapters: CompanyInputAdapters) {
  const orgName = String(values.orgName ?? '').trim();
  if (!orgName || orgName.length > 1024) throw new Error('companyCreate.nameRequired');
  const domain = adapters.parseDomain(String(values.domain ?? ''));
  if (domain === null) throw new Error('companyCreate.domainInvalid');
  const country = adapters.findCountry(String(values.countryCode ?? ''));
  return {
    ...values,
    orgName,
    domain,
    ...(country ? { countryCode: country.abb2, company_country: country.en } : {}),
  };
}
