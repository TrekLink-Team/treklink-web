// The header sort cycle of chapter 06 §11.2 (specs/frontend/ui-design/0-ui-standard.md §8.1), shared
// by DataTable and CollectionView. A click on an unsorted column sorts it ascending, a second click
// descending, a third returns to the list's default order. The column that is itself the default
// order toggles only its two directions.

export type SortDirectionKey = 'asc' | 'desc';

export interface SortKeyDirection<K extends string = string> {
  key: K;
  direction: SortDirectionKey;
}

/**
 * The sort after a click on the header of `key`. `current` is the active sort (null for the default
 * order); `defaultSort` is the list's default order when it is a column. Null means the default order.
 */
export function nextSort<K extends string>(
  current: SortKeyDirection<K> | null | undefined,
  key: K,
  defaultSort?: SortKeyDirection<K> | null,
): SortKeyDirection<K> | null {
  const active = current ?? defaultSort ?? null;
  if (defaultSort && defaultSort.key === key) {
    const direction = active?.key === key ? active.direction : defaultSort.direction;
    return { key, direction: direction === 'asc' ? 'desc' : 'asc' };
  }
  if (active?.key !== key) return { key, direction: 'asc' };
  if (active.direction === 'asc') return { key, direction: 'desc' };
  return defaultSort ?? null;
}

/** The `aria-sort` value of a column: only the sorted column carries one. */
export function ariaSortOf<K extends string>(
  sort: SortKeyDirection<K> | null | undefined,
  key: K,
): 'ascending' | 'descending' | undefined {
  if (!sort || sort.key !== key) return undefined;
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
