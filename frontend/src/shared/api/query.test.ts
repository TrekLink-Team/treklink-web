import { describe, expect, it } from 'vitest';
import { collectionSortOf, queryString, sortParamsOf } from './query';

describe('sortParamsOf and collectionSortOf (W26)', () => {
  const allowed = ['code', 'state'] as const;

  it('turns an allowed CollectionView sort into the sort and order query', () => {
    expect(sortParamsOf({ key: 'state', direction: 'desc' }, allowed)).toEqual({
      sort: 'state',
      order: 'desc',
    });
    expect(queryString({ ...sortParamsOf({ key: 'code', direction: 'asc' }, allowed) })).toBe(
      '?sort=code&order=asc',
    );
  });

  it('sends nothing for the default order or a key off the allowlist', () => {
    expect(sortParamsOf(null, allowed)).toEqual({});
    expect(sortParamsOf({ key: 'owner', direction: 'asc' }, allowed)).toEqual({});
    const byCode = { key: 'code', direction: 'desc' } as const;
    expect(sortParamsOf(byCode, allowed, byCode)).toEqual({});
    expect(sortParamsOf({ key: 'code', direction: 'asc' }, allowed, byCode)).toEqual({
      sort: 'code',
      order: 'asc',
    });
  });

  it('reads the sort back, ascending when the order is missing', () => {
    expect(collectionSortOf({ sort: 'code', order: 'desc' })).toEqual({ key: 'code', direction: 'desc' });
    expect(collectionSortOf({ sort: 'code' })).toEqual({ key: 'code', direction: 'asc' });
    expect(collectionSortOf({})).toBeNull();
  });
});
