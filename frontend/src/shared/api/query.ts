// The paged result every list endpoint returns (REQ-UBI-03), and the query string the list reads
// send. Shared by the entities, so one entity never imports another's API module.
export interface Page<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export const queryString = (params: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
};

/** The `sort` and `order` query of a list that sorts on the server (chapter 06 §11.2, W26). */
export interface SortParams<F extends string = string> {
  sort?: F;
  order?: 'asc' | 'desc';
}

/**
 * The SortParams of a CollectionView sort when its key is on the endpoint's allowlist; none for the
 * default order (null, or equal to `defaultSort` when the default is a column), so the server keeps
 * its own order and tiebreaker.
 */
export const sortParamsOf = <F extends string>(
  sort: { key: string; direction: 'asc' | 'desc' } | null | undefined,
  allowed: readonly F[],
  defaultSort?: { key: string; direction: 'asc' | 'desc' },
): SortParams<F> =>
  sort &&
  (allowed as readonly string[]).includes(sort.key) &&
  !(defaultSort && defaultSort.key === sort.key && defaultSort.direction === sort.direction)
    ? { sort: sort.key as F, order: sort.direction }
    : {};

/** The CollectionView sort of SortParams (an address or a filter state); null for the default order. */
export const collectionSortOf = (
  params: SortParams,
): { key: string; direction: 'asc' | 'desc' } | null =>
  params.sort ? { key: params.sort, direction: params.order ?? 'asc' } : null;
