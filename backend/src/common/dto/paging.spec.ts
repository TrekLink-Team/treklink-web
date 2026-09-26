import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DomainException } from '../errors';
import { PagedQueryDto, pagingBoundsFrom, resolvePage, toPagedResult } from './paging';

const BOUNDS = { defaultPageSize: 20, maxPageSize: 100 };

const validationErrors = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(PagedQueryDto, query)).map((e) => e.property);

describe('PagedQueryDto', () => {
  it('converts query-string numbers', () => {
    const dto = plainToInstance(PagedQueryDto, { pageNumber: '2', pageSize: '50' });
    expect(validateSync(dto)).toEqual([]);
    expect(dto).toEqual({ pageNumber: 2, pageSize: 50 });
  });

  it('rejects a zero, negative or fractional page number or size', () => {
    expect(validationErrors({ pageNumber: '0' })).toEqual(['pageNumber']);
    expect(validationErrors({ pageSize: '-5' })).toEqual(['pageSize']);
    expect(validationErrors({ pageSize: '2.5' })).toEqual(['pageSize']);
  });
});

describe('resolvePage', () => {
  it('applies page 1 and the default size when both are omitted', () => {
    expect(resolvePage({}, BOUNDS)).toEqual({ pageNumber: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('computes skip from the 1-based page number', () => {
    expect(resolvePage({ pageNumber: 3, pageSize: 50 }, BOUNDS)).toMatchObject({
      skip: 100,
      take: 50,
    });
  });

  it('accepts the maximum and rejects anything above it with VALIDATION_FAILED', () => {
    expect(resolvePage({ pageSize: 100 }, BOUNDS).pageSize).toBe(100);

    const call = () => resolvePage({ pageSize: 101 }, BOUNDS);
    expect(call).toThrow(DomainException);
    expect(call).toThrow('pageSize must not be greater than 100.');
    try {
      call();
    } catch (error) {
      expect((error as DomainException).errorCode).toBe('VALIDATION_FAILED');
      expect((error as DomainException).getStatus()).toBe(400);
    }
  });

  it('honours per-endpoint bounds', () => {
    expect(resolvePage({}, { defaultPageSize: 100, maxPageSize: 500 }).pageSize).toBe(100);
    expect(
      resolvePage({ pageSize: 500 }, { defaultPageSize: 100, maxPageSize: 500 }).pageSize,
    ).toBe(500);
  });
});

describe('pagingBoundsFrom', () => {
  it('reads DEFAULT_PAGE_SIZE and MAX_PAGE_SIZE', () => {
    expect(pagingBoundsFrom({ DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 })).toEqual(BOUNDS);
  });
});

describe('toPagedResult', () => {
  it('returns the REQ-UBI-03 shape with totalPages rounded up', () => {
    expect(toPagedResult(['a', 'b'], 142, { pageNumber: 1, pageSize: 20 })).toEqual({
      items: ['a', 'b'],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 142,
      totalPages: 8,
    });
  });

  it('reports zero pages for an empty collection', () => {
    expect(toPagedResult([], 0, { pageNumber: 1, pageSize: 20 }).totalPages).toBe(0);
  });
});
