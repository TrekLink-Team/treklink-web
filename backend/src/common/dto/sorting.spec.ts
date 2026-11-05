import { DomainException } from '../errors';
import { nullsLast, orderByOf, resolveSort, SortColumns, SortOrder } from './sorting';

type Order = Record<string, unknown>;

describe('resolveSort', () => {
  it('is undefined when nothing is requested', () => {
    expect(resolveSort({})).toBeUndefined();
  });

  it('sorts ascending when order is omitted', () => {
    expect(resolveSort({ sort: 'code' })).toEqual({ field: 'code', order: 'asc' });
    expect(resolveSort({ sort: 'code', order: 'desc' })).toEqual({ field: 'code', order: 'desc' });
  });

  it('rejects an order without sort with VALIDATION_FAILED', () => {
    const call = () => resolveSort({ order: 'desc' });
    expect(call).toThrow(DomainException);
    try {
      call();
    } catch (error) {
      expect((error as DomainException).errorCode).toBe('VALIDATION_FAILED');
      expect((error as DomainException).getStatus()).toBe(400);
    }
  });
});

describe('orderByOf', () => {
  const columns: SortColumns<'code' | 'seen', Order> = {
    code: (order) => ({ code: order }),
    seen: (order) => ({ seen: nullsLast(order) }),
  };
  const fallback: Order[] = [{ code: 'asc' }];
  const byId = (order: SortOrder): Order => ({ id: order });

  it('keeps the default order without a sort', () => {
    expect(orderByOf(undefined, columns, fallback, byId)).toBe(fallback);
  });

  it('puts the field first and breaks ties on id in the same direction', () => {
    expect(orderByOf({ field: 'code', order: 'desc' }, columns, fallback, byId)).toEqual([
      { code: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('sorts a nullable column with nulls last', () => {
    expect(orderByOf({ field: 'seen', order: 'asc' }, columns, fallback, byId)).toEqual([
      { seen: { sort: 'asc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });
});
