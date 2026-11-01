import React, { useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, MoreHorizontal, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { lockedWhileSelecting } from './lockedWhileSelecting';
import { Menu, type MenuItem } from './Menu';
import { Skeleton } from './Skeleton';
import { FOCUS } from './styles';

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

/** One action of a row: fewer than three render as inline buttons, three or more as a menu. */
export type RowAction = MenuItem;

/** Singular and plural noun of the rows, for "3 devices selected". */
export interface RowNoun {
  one: string;
  other: string;
}

export interface BulkSelection {
  ids: ReadonlySet<string>;
  /** True once the user chose "Select all N results": act on the whole filtered result. */
  allResults: boolean;
}

export interface DataTableProps<Row, K extends string = string> {
  /** Names the table for screen readers. */
  caption: string;
  columns: Column<Row, K>[];
  rows: Row[] | undefined;
  rowId: (row: Row) => string;
  /**
   * A readable name of a row, such as its code: names the row checkbox ("Select CT-2026-0142") and
   * the row actions. Required whenever rows are selectable or have actions.
   */
  rowLabel?: (row: Row) => string;
  /** What a row is, for the selection count. Defaults to row and rows. */
  noun?: RowNoun;
  loading?: boolean;
  /** Shown instead of the table: an ErrorState from bits.tsx, for example. */
  error?: React.ReactNode;
  empty: EmptyStateProps;
  sort?: SortState<K>;
  onSortChange?: (sort: SortState<K>) => void;
  /**
   * Row selection. The set lives in the page, so it survives paging and filtering; the table never
   * drops an id that is not on the current page.
   */
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** The total of the filtered result from the API, which offers "Select all N results". */
  totalCount?: number;
  allResultsSelected?: boolean;
  onSelectAllResults?: (selected: boolean) => void;
  /** The verb-plus-noun actions of the bulk bar, shown from the first selected row. */
  bulkActions?: (selection: BulkSelection) => React.ReactNode;
  /**
   * Row actions at the row end. Return a RowAction list: fewer than three render inline, more as a
   * menu button. Any other node renders as given (legacy), disabled while the bulk bar shows.
   */
  rowActions?: (row: Row) => RowAction[] | React.ReactNode;
  /** The row's detail route: the activation column becomes a link, so Enter opens it. */
  rowHref?: (row: Row) => string;
  /** The row whose details show in the Info pane. */
  activeRowId?: string;
  /** Opens a row in place (the Info pane): the activation column becomes a button. */
  onRowActivate?: (row: Row) => void;
  /** The column holding the row's link or button. Defaults to the first column. */
  activateColumn?: K;
  /** Phone layout: a card per row instead of a scrolling table. */
  renderCard?: (row: Row) => React.ReactNode;
  /** Height cap of the scroll box; the header row stays visible inside it. */
  maxHeight?: string;
  footer?: React.ReactNode;
  className?: string;
}

const CELL = 'px-3 py-0 align-middle first:pl-4 last:pr-4';
const ROW_NOUN: RowNoun = { one: 'row', other: 'rows' };
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="menuitem"]';

const countText = (count: number, noun: RowNoun) => `${count} ${count === 1 ? noun.one : noun.other}`;

const isActionList = (value: unknown): value is RowAction[] =>
  Array.isArray(value) &&
  value.every((item) => item !== null && typeof item === 'object' && 'key' in item && 'label' in item && 'onSelect' in item);

// The selection checkbox: a 20 px box in a 40 px label, so the hit area passes WCAG 2.5.8 with room
// to spare, and the shared focus ring. The click event carries Shift for range selection.
const CHECKBOX = cn(
  'h-5 w-5 shrink-0 cursor-pointer rounded border-line-strong accent-[rgb(var(--tl-accent))]',
  FOCUS,
);
const CHECKBOX_HIT = 'flex h-10 w-10 cursor-pointer select-none items-center justify-center rounded-control hover:bg-chrome/60';

export interface BulkBarProps {
  count: number;
  noun?: RowNoun;
  /** Verb-plus-noun buttons: "Retire 3 devices", never "Apply". */
  actions: React.ReactNode;
  onClear: () => void;
  /** Offered while every row of the page is selected and more results exist. */
  selectAll?: { total: number; onSelect: () => void };
  allResults?: boolean;
  className?: string;
}

/**
 * The bar that replaces the table's top edge once a row is selected: the count, the bulk actions and
 * Clear selection. DataTable renders it through `bulkActions` and announces the count in a status
 * region that stays mounted; a page that renders BulkBar alone must announce the count itself.
 */
export const BulkBar: React.FC<BulkBarProps> = ({ count, noun = ROW_NOUN, actions, onClear, selectAll, allResults, className }) => (
  <div
    role="group"
    aria-label="Bulk actions"
    className={cn('flex min-h-14 flex-wrap items-center gap-2 border-b border-line bg-chrome px-3 py-2', className)}
  >
    <span className="pr-1 font-bold text-ink">
      {allResults ? `All ${countText(count, noun)} selected` : `${countText(count, noun)} selected`}
    </span>
    {selectAll && !allResults && (
      <button type="button" onClick={selectAll.onSelect} className={cn('min-h-11 rounded-sm px-1 font-semibold text-brand underline underline-offset-4', FOCUS)}>
        Select all {countText(selectAll.total, noun)}
      </button>
    )}
    <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />
    <div className="flex flex-wrap items-center gap-2">{actions}</div>
    <Button size="sm" variant="ghost" className="ml-auto" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={onClear}>
      Clear selection
    </Button>
  </div>
);

/**
 * Pattern A of convention 06 §4 and the data table rules of
 * specs/frontend/ui-design/0-ui-standard.md §2: a Toolbar above, then this table, then a Pagination
 * as `footer`. Sorting and paging are the server's; the table only reports the change. Rows are
 * 48 px; the header is sticky inside the scroll box.
 */
export function DataTable<Row, K extends string = string>({
  caption,
  columns,
  rows,
  rowId,
  rowLabel,
  noun = ROW_NOUN,
  loading,
  error,
  empty,
  sort,
  onSortChange,
  selectedIds,
  onSelectionChange,
  totalCount,
  allResultsSelected = false,
  onSelectAllResults,
  bulkActions,
  rowActions,
  rowHref,
  activeRowId,
  onRowActivate,
  activateColumn,
  renderCard,
  maxHeight,
  footer,
  className,
}: DataTableProps<Row, K>) {
  const tableId = useId();
  const anchor = useRef<string | null>(null);
  const selectable = Boolean(selectedIds && onSelectionChange);
  const selection = selectedIds ?? new Set<string>();
  const ids = rows?.map(rowId) ?? [];
  const pageSelected = ids.filter((id) => selection.has(id)).length;
  const allSelected = selectable && ids.length > 0 && pageSelected === ids.length;
  const someSelected = selectable && pageSelected > 0 && !allSelected;
  const count = allResultsSelected && totalCount !== undefined ? totalCount : selection.size;
  const bulkActive = Boolean(bulkActions) && selectable && count > 0;
  const labelOf = (row: Row, index: number) => rowLabel?.(row) ?? `row ${index + 1}`;
  const activationKey = activateColumn ?? columns[0]?.key;
  const activates = Boolean(rowHref || onRowActivate);

  const change = (next: Set<string>) => {
    if (allResultsSelected) onSelectAllResults?.(false);
    onSelectionChange?.(next);
  };

  // The header box acts on this page only, so rows chosen on other pages stay selected.
  const toggleAll = () => {
    const next = new Set(selection);
    if (allSelected) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    change(next);
  };

  // Shift-click selects or clears every row between the last clicked row and this one.
  const toggle = (id: string, shift: boolean) => {
    const next = new Set(selection);
    const target = !selection.has(id);
    const from = anchor.current ? ids.indexOf(anchor.current) : -1;
    const to = ids.indexOf(id);
    if (shift && from >= 0 && to >= 0) {
      const [low, high] = from < to ? [from, to] : [to, from];
      ids.slice(low, high + 1).forEach((rangeId) => (target ? next.add(rangeId) : next.delete(rangeId)));
    } else if (target) next.add(id);
    else next.delete(id);
    anchor.current = id;
    change(next);
  };

  const clear = () => {
    anchor.current = null;
    change(new Set());
  };

  const sortBy = (key: K) => {
    if (!onSortChange) return;
    const direction: SortDirection = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, direction });
  };

  // A pointer click anywhere on a row opens it, as a shortcut for the link or button in the
  // activation column, which is the keyboard path.
  const onRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    event.currentTarget.querySelector<HTMLElement>('[data-row-activate]')?.click();
  };

  const activation = (row: Row, column: Column<Row, K>) => {
    const content = column.truncate ? (
      <span title={column.truncate(row)} className="block truncate">
        {column.cell(row)}
      </span>
    ) : (
      column.cell(row)
    );
    const classes = cn('block max-w-full rounded-sm text-left font-semibold text-ink hover:underline underline-offset-4', FOCUS);
    if (rowHref)
      return (
        <Link to={rowHref(row)} data-row-activate="" className={classes}>
          {content}
        </Link>
      );
    return (
      <button type="button" data-row-activate="" onClick={() => onRowActivate?.(row)} className={cn(classes, 'min-h-6')}>
        {content}
      </button>
    );
  };

  const renderActions = (row: Row, label: string) => {
    if (!rowActions) return null;
    const given = rowActions(row);
    if (!isActionList(given))
      return (
        <fieldset disabled={bulkActive} className="m-0 inline-flex min-w-0 border-0 p-0">
          {given}
        </fieldset>
      );
    const actions = lockedWhileSelecting(given, bulkActive);
    if (actions.length >= 3)
      return (
        <Menu
          label={`Actions for ${label}`}
          title="More actions"
          trigger={<MoreHorizontal aria-hidden="true" className="h-5 w-5" />}
          items={actions}
        />
      );
    return (
      <span className="inline-flex items-center gap-1">
        {actions.map((action) => {
          const reasonId = action.disabled && action.disabledReason ? `${tableId}-${rowId(row)}-${action.key}-reason` : undefined;
          return (
            <React.Fragment key={action.key}>
              <Button
                size="sm"
                variant="ghost"
                icon={action.icon}
                aria-disabled={action.disabled || undefined}
                aria-describedby={reasonId}
                title={action.disabled ? action.disabledReason : undefined}
                onClick={() => {
                  if (!action.disabled) action.onSelect();
                }}
                className={cn(
                  action.destructive && 'text-status-critical-fg',
                  action.disabled && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                )}
              >
                {action.label}{' '}
                <span className="sr-only">{label}</span>
              </Button>
              {reasonId && (
                <span id={reasonId} className="sr-only">
                  {action.disabledReason}
                </span>
              )}
            </React.Fragment>
          );
        })}
      </span>
    );
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

  // The selection count is announced from a region that stays mounted (WCAG 4.1.3), so a screen
  // reader hears it without focus moving to the bar.
  const announcement = selectable ? (
    <div role="status" aria-live="polite" className="sr-only">
      {count > 0
        ? allResultsSelected
          ? `All ${countText(count, noun)} selected`
          : `${countText(count, noun)} selected`
        : ''}
    </div>
  ) : null;

  if (!rows || rows.length === 0) {
    return (
      <div className={shell}>
        {announcement}
        <EmptyState {...empty} />
      </div>
    );
  }

  const offerAll =
    onSelectAllResults && totalCount !== undefined && allSelected && totalCount > selection.size
      ? { total: totalCount, onSelect: () => onSelectAllResults(true) }
      : undefined;

  const rowCheckbox = (row: Row, index: number) => {
    const id = rowId(row);
    return (
      <label className={CHECKBOX_HIT}>
        <input
          type="checkbox"
          aria-label={`Select ${labelOf(row, index)}`}
          checked={selection.has(id)}
          onChange={(event) => toggle(id, (event.nativeEvent as MouseEvent).shiftKey === true)}
          className={CHECKBOX}
        />
      </label>
    );
  };

  return (
    <div className={shell}>
      {announcement}
      {bulkActive && bulkActions && (
        <BulkBar
          count={count}
          noun={noun}
          allResults={allResultsSelected}
          selectAll={offerAll}
          onClear={clear}
          actions={bulkActions({ ids: selection, allResults: allResultsSelected })}
        />
      )}
      {renderCard && (
        <ul aria-label={caption} className="flex flex-col divide-y divide-line md:hidden">
          {rows.map((row, index) => (
            <li key={rowId(row)} className={cn('flex items-start gap-2 p-4', rowId(row) === activeRowId && 'bg-chrome/60')}>
              {selectable && <span className="-ml-2 -mt-2">{rowCheckbox(row, index)}</span>}
              <div className="min-w-0 flex-1">{renderCard(row)}</div>
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
                <th scope="col" className="w-12 pl-2">
                  <label className={CHECKBOX_HIT}>
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      className={CHECKBOX}
                    />
                  </label>
                </th>
              )}
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const ariaSort = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortable && onSortChange ? ariaSort : undefined}
                    style={{ width: column.width }}
                    className={cn(CELL, 'h-10 font-extrabold', column.align === 'end' && 'text-right', column.hideOnMobile && 'hidden md:table-cell')}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => sortBy(column.key)}
                        className={cn(
                          'inline-flex min-h-8 items-center gap-1 rounded-sm uppercase hover:text-ink',
                          FOCUS,
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
            {rows.map((row, index) => {
              const id = rowId(row);
              const selected = selection.has(id);
              const label = labelOf(row, index);
              return (
                <tr
                  key={id}
                  aria-selected={selectable ? selected : undefined}
                  onClick={activates ? onRowClick : undefined}
                  className={cn(
                    'h-12 border-t border-line transition-colors duration-tl',
                    activates && 'cursor-pointer hover:bg-chrome/40',
                    id === activeRowId && 'bg-chrome/50',
                    selected && 'bg-chrome',
                  )}
                >
                  {selectable && <td className="pl-2">{rowCheckbox(row, index)}</td>}
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
                      {activates && column.key === activationKey
                        ? activation(row, column)
                        : column.truncate
                          ? <Truncated text={column.truncate(row)}>{column.cell(row)}</Truncated>
                          : column.cell(row)}
                    </td>
                  ))}
                  {rowActions && <td className="pr-3 text-right">{renderActions(row, label)}</td>}
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
    className={cn('block truncate rounded-sm focus:whitespace-normal focus:break-words', FOCUS)}
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
    'inline-flex h-11 min-w-11 items-center justify-center rounded-control px-2 text-body-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55';
  return (
    <nav aria-label="Pages" className={cn('flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-body-sm text-ink-muted', className)}>
      {onPageSize && pageSize && (
        <label className="flex items-center gap-2">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-11 rounded-control border border-line-strong bg-surface px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
