import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { Skeleton } from './Skeleton';

export type SortDirection = 'asc' | 'desc';
export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

export interface Column<Row, K extends string = string> {
  key: K;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /** Server-sorted columns are the ones a user filters on (convention 06 §8.4). */
  sortable?: boolean;
  align?: 'start' | 'end';
  /** Long text: one line with an ellipsis, the full value on hover (title) and on focus. */
  truncate?: (row: Row) => string;
  /** CSS width, for example '8rem'. */
  width?: string;
  /** Hidden below the md breakpoint when the table scrolls instead of using cards. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<Row, K extends string = string> {
  /** Names the table for screen readers. */
  caption: string;
  columns: Column<Row, K>[];
  rows: Row[] | undefined;
  rowId: (row: Row) => string;
  loading?: boolean;
  /** Shown instead of the table: an ErrorState from bits.tsx, for example. */
  error?: React.ReactNode;
  empty: EmptyStateProps;
  sort?: SortState<K>;
  onSortChange?: (sort: SortState<K>) => void;
  /** Row selection for bulk actions in the toolbar. */
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Row actions at the row end (convention 06 §8.2): usually one IconButton opening a menu. */
  rowActions?: (row: Row) => React.ReactNode;
  /** The row whose details show in the Info pane. */
  activeRowId?: string;
  onRowActivate?: (row: Row) => void;
  /** Phone layout: a card per row instead of a scrolling table. */
  renderCard?: (row: Row) => React.ReactNode;
  /** Height cap of the scroll box; the header row stays visible inside it. */
  maxHeight?: string;
  footer?: React.ReactNode;
  className?: string;
}

const CELL = 'px-3 py-0 align-middle first:pl-4 last:pr-4';

/**
 * Pattern A of convention 06 §4: put the search and filters in a Toolbar above, then this table,
 * then a Pagination as `footer`. Sorting and paging are the server's; the table only reports the
 * change. Rows are 48 px; the header is sticky inside the scroll box.
 */
export function DataTable<Row, K extends string = string>({
  caption,
  columns,
  rows,
  rowId,
  loading,
  error,
  empty,
  sort,
  onSortChange,
  selectedIds,
  onSelectionChange,
  rowActions,
  activeRowId,
  onRowActivate,
  renderCard,
  maxHeight,
  footer,
  className,
}: DataTableProps<Row, K>) {
  const selectable = Boolean(selectedIds && onSelectionChange);
  const ids = rows?.map(rowId) ?? [];
  const allSelected = selectable && ids.length > 0 && ids.every((id) => selectedIds!.has(id));
  const someSelected = selectable && ids.some((id) => selectedIds!.has(id));

  const toggleAll = () => onSelectionChange?.(allSelected ? new Set() : new Set(ids));
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange?.(next);
  };

  const sortBy = (key: K) => {
    if (!onSortChange) return;
    const direction: SortDirection = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, direction });
  };

  if (error) return <>{error}</>;

  const shell = cn('overflow-hidden rounded-panel border border-line bg-surface shadow-raise', className);

  if (loading) {
    return (
      <div className={shell} role="status" aria-live="polite">
        <span className="sr-only">Loading {caption}</span>
        <div className="flex flex-col gap-2 p-4">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-10" />
          ))}
        </div>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className={shell}>
        <EmptyState {...empty} />
      </div>
    );
  }

  return (
    <div className={shell}>
      {renderCard && (
        <ul aria-label={caption} className="flex flex-col divide-y divide-line md:hidden">
          {rows.map((row) => (
            <li key={rowId(row)} className={cn('p-4', rowId(row) === activeRowId && 'bg-chrome/60')}>
              {renderCard(row)}
            </li>
          ))}
        </ul>
      )}
      <div className={cn('overflow-auto', renderCard && 'hidden md:block')} style={{ maxHeight }}>
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-raised bg-sunken">
            <tr className="text-left text-label uppercase text-ink-muted">
              {selectable && (
                <th scope="col" className="w-12 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={toggleAll}
                    className="h-[18px] w-[18px] cursor-pointer accent-[rgb(var(--tl-accent))]"
                  />
                </th>
              )}
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const ariaSort = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortable ? (ariaSort ?? 'none') : undefined}
                    style={{ width: column.width }}
                    className={cn(CELL, 'h-10 font-extrabold', column.align === 'end' && 'text-right', column.hideOnMobile && 'hidden md:table-cell')}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => sortBy(column.key)}
                        className={cn(
                          'inline-flex min-h-8 items-center gap-1 rounded-sm uppercase hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus',
                          active && 'text-ink',
                          column.align === 'end' && 'flex-row-reverse',
                        )}
                      >
                        {column.header}
                        {active ? (
                          sort!.direction === 'asc' ? (
                            <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5 opacity-60" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="w-14 pr-4">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowId(row);
              const selected = selectedIds?.has(id) ?? false;
              return (
                <tr
                  key={id}
                  aria-selected={selectable ? selected : undefined}
                  onClick={onRowActivate ? () => onRowActivate(row) : undefined}
                  className={cn(
                    'h-12 border-t border-line transition-colors duration-tl',
                    onRowActivate && 'cursor-pointer hover:bg-chrome/40',
                    id === activeRowId && 'bg-chrome/50',
                    selected && 'bg-chrome',
                  )}
                >
                  {selectable && (
                    <td className="pl-4" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select row ${id}`}
                        checked={selected}
                        onChange={() => toggle(id)}
                        className="h-[18px] w-[18px] cursor-pointer accent-[rgb(var(--tl-accent))]"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        CELL,
                        column.align === 'end' && 'text-right tabular-nums',
                        column.hideOnMobile && 'hidden md:table-cell',
                        column.truncate && 'max-w-0',
                      )}
                    >
                      {column.truncate ? <Truncated text={column.truncate(row)}>{column.cell(row)}</Truncated> : column.cell(row)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="pr-3 text-right" onClick={(event) => event.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}

/** One line with an ellipsis; hovering shows the full value, and focusing expands it in place. */
export const Truncated: React.FC<{ text: string; children?: React.ReactNode }> = ({ text, children }) => (
  <span
    title={text}
    tabIndex={0}
    className="block truncate rounded-sm focus:whitespace-normal focus:break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
  >
    {children ?? text}
  </span>
);

export interface PaginationProps {
  pageNumber: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  onPage: (page: number) => void;
  pageSizes?: number[];
  onPageSize?: (size: number) => void;
  className?: string;
}

const pagesAround = (page: number, total: number): (number | 'gap')[] => {
  const wanted = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, index) => {
    if (index > 0 && p - sorted[index - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
};

/** Server paging under a table: range text, page size, previous, numbered pages, next. */
export const Pagination: React.FC<PaginationProps> = ({
  pageNumber,
  totalPages,
  totalItems,
  pageSize,
  onPage,
  pageSizes = [10, 20, 50],
  onPageSize,
  className,
}) => {
  const from = totalItems !== undefined && pageSize ? (pageNumber - 1) * pageSize + 1 : undefined;
  const to = from !== undefined && totalItems !== undefined && pageSize ? Math.min(totalItems, pageNumber * pageSize) : undefined;
  const button =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-control px-2 text-body-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55';
  return (
    <nav aria-label="Pages" className={cn('flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-body-sm text-ink-muted', className)}>
      {onPageSize && pageSize && (
        <label className="flex items-center gap-2">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-9 rounded-control border border-line-strong bg-surface px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
      {from !== undefined && to !== undefined && (
        <span className="sm:ml-auto" aria-live="polite">
          {from} to {to} of {totalItems}
        </span>
      )}
      <div className={cn('flex items-center gap-1', from === undefined && 'ml-auto')}>
        <button
          type="button"
          aria-label="Previous page"
          disabled={pageNumber <= 1}
          onClick={() => onPage(pageNumber - 1)}
          className={cn(button, 'border border-line-strong bg-surface text-ink')}
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        {pagesAround(pageNumber, totalPages).map((page, index) =>
          page === 'gap' ? (
            <span key={`gap-${index}`} aria-hidden="true" className="px-1">
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              aria-label={`Page ${page}`}
              aria-current={page === pageNumber ? 'page' : undefined}
              onClick={() => onPage(page)}
              className={cn(button, 'hidden sm:inline-flex', page === pageNumber ? 'bg-chrome text-ink' : 'text-ink hover:bg-chrome/60')}
            >
              {page}
            </button>
          ),
        )}
        <span className="px-2 text-ink sm:hidden">
          {pageNumber} / {totalPages}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={pageNumber >= totalPages}
          onClick={() => onPage(pageNumber + 1)}
          className={cn(button, 'border border-line-strong bg-surface text-ink')}
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
};
