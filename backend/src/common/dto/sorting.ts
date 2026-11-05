import { HttpStatus } from '@nestjs/common';
import { DomainException, ErrorCode } from '../errors';

// Shared server sort of the paged lists (chapter 06 §11.2, W26). A list endpoint takes `sort`, one
// field of its allowlist, and `order`, `asc` or `desc`. The query DTO validates `sort` with `IsIn` on
// the allowlist, so an unknown field answers 400 VALIDATION_FAILED before the service runs; the
// repository maps each allowed field to its own Prisma `orderBy`, so no `orderBy` is ever built from
// an unchecked string. Without `sort` the list keeps its documented default order.

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export interface ListSort<F extends string> {
  field: F;
  order: SortOrder;
}

export interface SortQuery<F extends string> {
  sort?: F;
  order?: SortOrder;
}

// The requested sort of a validated query: ascending when `order` is omitted, undefined without `sort`.
// An `order` without `sort` names no column, so it answers 400 VALIDATION_FAILED.
export function resolveSort<F extends string>(query: SortQuery<F>): ListSort<F> | undefined {
  if (query.sort === undefined) {
    if (query.order !== undefined) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'order needs sort: name the field to sort on.',
      );
    }
    return undefined;
  }
  return { field: query.sort, order: query.order ?? 'asc' };
}

// The Prisma `orderBy` entries of one allowed field in one direction.
export type SortColumns<F extends string, O> = Record<F, (order: SortOrder) => O>;

// A nullable column: a missing value sorts last in either direction.
export const nullsLast = (order: SortOrder) => ({ sort: order, nulls: 'last' as const });

// The `orderBy` of a page: the requested field then the tiebreaker in the same direction, so a page
// never repeats or skips a row; the list's default order when nothing is requested.
export function orderByOf<F extends string, O>(
  sort: ListSort<F> | undefined,
  columns: SortColumns<F, O>,
  fallback: O[],
  tiebreaker: (order: SortOrder) => O,
): O[] {
  if (!sort) return fallback;
  return [columns[sort.field](sort.order), tiebreaker(sort.order)];
}
