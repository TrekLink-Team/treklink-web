import type { CollectionPageInfo } from './types';

/** The page a server returned (D-002 paging), as CollectionView announces it: total, from, to. */
export const pageInfoOf = (
  page:
    | { pageNumber: number; pageSize: number; totalCount: number; items: readonly unknown[] }
    | undefined,
): CollectionPageInfo | undefined =>
  page
    ? {
        total: page.totalCount,
        from: page.totalCount === 0 ? 0 : (page.pageNumber - 1) * page.pageSize + 1,
        to: (page.pageNumber - 1) * page.pageSize + page.items.length,
      }
    : undefined;
