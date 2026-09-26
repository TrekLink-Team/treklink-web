import { HttpStatus } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { DomainException, ErrorCode } from '../errors';

// Shared paging contract (REQ-UBI-03, 05-backend-conventions.md §3.2). Query DTOs extend
// PagedQueryDto; services return PagedResult<T>, which the response interceptor passes through.

export class PagedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export interface PagedResult<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// Defaults come from DEFAULT_PAGE_SIZE and MAX_PAGE_SIZE. An endpoint whose api-design declares
// different bounds passes its own.
export interface PagingBounds {
  defaultPageSize: number;
  maxPageSize: number;
}

// Bounds from the validated environment (specs/platform/requirements.md §4).
export const pagingBoundsFrom = (env: {
  DEFAULT_PAGE_SIZE: number;
  MAX_PAGE_SIZE: number;
}): PagingBounds => ({ defaultPageSize: env.DEFAULT_PAGE_SIZE, maxPageSize: env.MAX_PAGE_SIZE });

export interface ResolvedPage {
  pageNumber: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function resolvePage(query: PagedQueryDto, bounds: PagingBounds): ResolvedPage {
  const pageNumber = query.pageNumber ?? 1;
  const pageSize = query.pageSize ?? bounds.defaultPageSize;
  if (pageSize > bounds.maxPageSize) {
    throw new DomainException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      `pageSize must not be greater than ${bounds.maxPageSize}.`,
    );
  }
  return { pageNumber, pageSize, skip: (pageNumber - 1) * pageSize, take: pageSize };
}

export function toPagedResult<T>(
  items: T[],
  totalCount: number,
  page: Pick<ResolvedPage, 'pageNumber' | 'pageSize'>,
): PagedResult<T> {
  return {
    items,
    pageNumber: page.pageNumber,
    pageSize: page.pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / page.pageSize),
  };
}
