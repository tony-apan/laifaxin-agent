import { postEnvelope } from '@/api/auth';
import type { PageResult } from '@/api/expenses';
import type { RatingReport } from '@/api/rating';

/** 旧项目 DomainInfoDrawerV2 使用的详情契约，与公司列表的批量接口分开。 */
export interface CompanyEmail {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  verify_status?: string;
  linkedin_url?: string;
  link?: string;
  contact?: { cid?: string; email?: string; tags?: string[] };
}

export interface CompanyEmailQuery {
  domain: string;
  current: number;
  pageSize: number;
  filter: { verify_status?: string[] };
  sort: Record<string, 1 | -1>;
}

export async function listCompanyEmails(query: CompanyEmailQuery) {
  const data = await postEnvelope<PageResult<CompanyEmail> | undefined>(
    '/clues/domain-email-list',
    { ...query },
  );
  return { list: data?.list ?? [], total: data?.total ?? 0 };
}

export const unlockCompanyEmail = (body: {
  id: string;
  domain: string;
  contactTags: string[];
  sort: Record<string, 1 | -1>;
}) => postEnvelope<unknown>('/clues/domain-email-save', body);

export const saveCompanyTags = (id: string, tags: string[]) =>
  postEnvelope<unknown>('/contacts/company/save', { id, tags });

export interface CompanyRating {
  status?: string;
  score?: number;
  chat_id?: string;
  comment?: string;
  chatInfo?: RatingReport;
}

export const getCompanyRating = (domain: string, productId: string) =>
  postEnvelope<CompanyRating | undefined>('/clues/domain-rating-info', { domain, productId });

export const createCompanyRating = (domain: string, productId: string) =>
  postEnvelope<{ taskId?: string } | undefined>('/clues/domain-rating-create', {
    domain,
    productId,
  });
