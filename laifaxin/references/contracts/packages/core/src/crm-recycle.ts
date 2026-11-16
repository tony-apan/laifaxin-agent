import type { FilterCondition, Logic } from './crm';
export const RECYCLE_TIME_PRESETS = [
  'today',
  'yestoday',
  'last24Hours',
  'thisIsoWeek',
  'lastIsoWeek',
  'thisMonth',
  'lastMonth',
  'last7Days',
  'last30Days',
  'last60Days',
  'last90Days',
] as const;

export type RecycleKind = 'contacts' | 'companies';

export interface RecycleFilter {
  keyword: string;
  tags: string[];
  owners: string[];
  deleteTime: string;
}

/** 回收站旧接口只接受这三种条件的交集，不能直接发送 CRM 高级 filters。 */
export function recycleFilter(
  query: {
    keyword: string;
    filters: FilterCondition[];
    logic: Logic;
    deleteTime?: string;
  },
  kind: RecycleKind,
  message?: string,
): RecycleFilter {
  const fail = () => {
    throw new Error(
      message ??
        (kind === 'contacts'
          ? 'recycle.contactFilterUnsupported'
          : 'recycle.companyFilterUnsupported'),
    );
  };
  if (query.logic === 'or' && query.filters.length > 1) fail();
  const result: RecycleFilter = {
    keyword: query.keyword,
    tags: [],
    owners: [],
    deleteTime: query.deleteTime ?? '',
  };
  const seen = new Set<string>();
  for (const filter of query.filters) {
    if (seen.has(filter.property)) fail();
    seen.add(filter.property);
    if (
      ['tags', 'deleteUid'].includes(filter.property) &&
      filter.operator === 'include' &&
      filter.values?.every((v) => typeof v === 'string')
    ) {
      result[filter.property === 'tags' ? 'tags' : 'owners'] = filter.values as string[];
    } else if (
      filter.property === 'deleteTime' &&
      filter.operator === 'eq' &&
      typeof filter.value === 'string'
    ) {
      result.deleteTime = filter.value;
    } else fail();
  }
  if (
    result.deleteTime &&
    !RECYCLE_TIME_PRESETS.some((value) => value === result.deleteTime) &&
    !/^\d{4}-\d{2}-\d{2}$/.test(result.deleteTime)
  )
    fail();
  return result;
}

export const companyRecycleSort = (sort: Record<string, 1 | -1>) =>
  Object.fromEntries(
    Object.entries(sort).map(([key, direction]) => [
      key === 'name' ? 'orgName' : key === 'country_code' ? 'countryCode' : key,
      direction,
    ]),
  );

export interface RecycleRestoreProgress {
  status: string;
  progress: number;
  finished: number;
  total: number;
}
