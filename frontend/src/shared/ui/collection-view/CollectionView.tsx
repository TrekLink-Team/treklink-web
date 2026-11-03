import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Info,
  LayoutGrid,
  List as ListIcon,
  PanelRight,
  Search,
  Table2,
  X,
} from 'lucide-react';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Button } from '../Button';
import { cn } from '../cn';
import { EmptyState } from '../EmptyState';
import { Menu, type MenuItem } from '../Menu';
import { useEdgeNode, useFocusClearOf, usePublishedHeight } from '../stickyEdges';
import { ScrollHintOverlay } from '../ScrollHints';
import { useScrollHints } from '../useScrollHints';
import { Skeleton } from '../Skeleton';
import { FOCUS, LINK } from '../styles';
import { DetailsPane, StatusMenu, type PanePlacement } from './DetailsPane';
import { usePaneHost } from './paneHostContext';
import {
  EMPTY_SELECTION,
  keepVisible,
  pageSelection,
  toggleAll,
  toggleItem,
  type SelectionState,
} from './selection';
import { TooltipButton } from './TooltipButton';
import type {
  CollectionAction,
  CollectionBulkAction,
  CollectionCommand,
  CollectionDetails,
  CollectionEmptyState,
  CollectionField,
  CollectionFilter,
  CollectionNoun,
  CollectionPageInfo,
  CollectionQuery,
  CollectionSort,
  CollectionTransition,
  CollectionViewKey,
} from './types';
import { useLiveRegion } from './useLiveRegion';

// CollectionView (chapter 06 §9, D-096): the one module that renders every list of records. It
// holds the view, the selection, the one-row command bar, the item actions and the details pane;
// the page holds the data. Selection covers the items of the current page only, and a search,
// filter or sort change clears it (leader, 2026-11-03).

export const SEARCH_ANNOUNCE_MS = 500;
export const SELECTION_CLEARED = 'Selection cleared';
export const NO_MATCHES = 'No results match your filters.';

const VIEW_LABEL: Record<CollectionViewKey, string> = {
  details: 'Details list',
  list: 'List',
  cards: 'Cards',
};

const VIEW_ICON: Record<CollectionViewKey, React.ReactNode> = {
  details: <Table2 />,
  list: <ListIcon />,
  cards: <LayoutGrid />,
};

const MENU_TRIGGER = 'h-10 border border-line-strong bg-surface px-3 text-body-sm';

const countText = (count: number, noun: CollectionNoun) =>
  `${count} ${count === 1 ? noun.one : noun.other}`;

export interface CollectionViewProps<T> {
  /** Names the collection: the table caption, the region and the command bar ("Devices of CT-0042"). */
  label: string;
  /** The current page of a query result, or undefined while it loads. */
  items: T[] | undefined;
  itemId: (item: T) => string;
  /** The text that names one item in accessible names and confirmations ("TL-0042"). */
  itemName: (item: T) => string;
  /** The item's title as shown; defaults to the name, linked when `itemHref` gives a path. */
  itemTitle?: (item: T) => React.ReactNode;
  itemHref?: (item: T) => string | undefined;
  fields: CollectionField<T>[];
  noun: CollectionNoun;
  itemActions?: CollectionAction<T>[];
  transitions?: (item: T) => CollectionTransition<T>[];
  /** The item's current status as text, shown on its Change status button (§9.6 rule 1). */
  statusOf?: (item: T) => string;
  bulkActions?: CollectionBulkAction<T>[];
  commands?: CollectionCommand[];
  views?: CollectionViewKey[];
  defaultView?: CollectionViewKey;
  /** The details pane of §9.8; false leaves it out. */
  details?: CollectionDetails<T> | false;
  /**
   * A page's own record view (a drawer with its own actions) in place of the built-in pane: Show
   * details stays the first item action and opens it, and the command bar has no pane toggle.
   */
  onShowDetails?: (item: T) => void;
  emptyState: CollectionEmptyState;
  search?: { label: string; placeholder?: string };
  filters?: CollectionFilter<T>[];
  /** A controlled query. With `onQueryChange` the page filters, searches and sorts on the server. */
  query?: CollectionQuery;
  onQueryChange?: (query: CollectionQuery) => void;
  pageInfo?: CollectionPageInfo;
  loading?: boolean;
  error?: React.ReactNode;
  /** Pagination, under the items. */
  footer?: React.ReactNode;
  /** The command bar's sticky offset; by default under the sticky page header. */
  stickyTop?: string;
  /** Hides the command bar; by default it hides when there is nothing to filter, sort or switch. */
  hideCommandBar?: boolean;
  /** `hideWithPane` columns also leave when the list itself is narrower than 1100 px (§10.8). */
  fitNarrow?: boolean;
  /**
   * Names any other filter the page applies outside the command bar (status chips kept in the
   * address). A change clears the selection, like a search, filter or sort change (§9.4 rule 4).
   */
  resetKey?: string;
  className?: string;
}

export function CollectionView<T>({
  label,
  items,
  itemId,
  itemName,
  itemTitle,
  itemHref,
  fields,
  noun,
  itemActions = [],
  transitions,
  statusOf,
  bulkActions = [],
  commands = [],
  views = ['details', 'list'],
  defaultView,
  details = {},
  onShowDetails,
  emptyState,
  search,
  filters,
  query: controlledQuery,
  onQueryChange,
  pageInfo,
  loading,
  error,
  footer,
  stickyTop,
  hideCommandBar,
  fitNarrow,
  resetKey,
  className,
}: CollectionViewProps<T>) {
  const baseId = useId();
  const searchId = `${baseId}-search`;
  // Laptop from 1100 px, tablet from 600 px, phone below (§10.5, §10.8). A renderer without
  // matchMedia is treated as a laptop.
  const wide = useMediaQuery('(min-width: 1100px)', true);
  const tablet = useMediaQuery('(min-width: 600px)', true);
  const phone = !tablet;
  const serverSide = Boolean(onQueryChange);

  const firstFilter = filters?.[0]?.key ?? '';
  const [ownQuery, setOwnQuery] = useState<CollectionQuery>({
    search: '',
    filter: firstFilter,
    sort: null,
  });
  const query = controlledQuery ?? ownQuery;
  const [chosenView, setChosenView] = useState<CollectionViewKey | null>(null);
  const view: CollectionViewKey =
    chosenView ?? (phone && views.includes('list') ? 'list' : (defaultView ?? views[0]));
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [paneId, setPaneId] = useState<string | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { message, announce } = useLiveRegion();
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const lastFocus = useRef<{ id: string; index: number } | null>(null);
  const [barNode, setBarNode] = useEdgeNode<HTMLDivElement>();
  const tableScroller = useRef<HTMLDivElement>(null);
  const tableHints = useScrollHints(tableScroller);
  usePublishedHeight(barNode, '--tl-collection-bar-h');
  useFocusClearOf(barNode, 'top');

  const selectable = bulkActions.length > 0 || transitions !== undefined;
  const showPane = details !== false && onShowDetails === undefined;
  const offersDetails = showPane || onShowDetails !== undefined;

  // The visible items: a server-paged collection shows the page as given; a client collection
  // filters, searches and sorts the items it holds.
  const visible = useMemo(() => {
    const all = items ?? [];
    if (serverSide) return all;
    const filter = filters?.find((each) => each.key === query.filter);
    const needle = query.search.trim().toLowerCase();
    const searched = all.filter(
      (item) =>
        (!filter?.test || filter.test(item)) &&
        (needle === '' ||
          [itemName(item), ...fields.map((field) => field.text?.(item) ?? '')]
            .join(' ')
            .toLowerCase()
            .includes(needle)),
    );
    const sort = query.sort;
    const field = sort ? fields.find((each) => each.key === sort.key) : undefined;
    if (!sort || !field) return searched;
    const value = (item: T) => field.sortValue?.(item) ?? field.text?.(item) ?? '';
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...searched].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return (
        (typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true })) * factor
      );
    });
  }, [items, serverSide, filters, query, fields, itemName]);

  const ids = useMemo(() => visible.map(itemId), [visible, itemId]);
  const byId = useMemo(() => new Map(visible.map((item) => [itemId(item), item])), [visible, itemId]);

  // A bulk action never acts on items the user can no longer see (a page change or a refetch): the
  // selection drops ids the page no longer holds, adjusted during render when the ids change.
  // The drop is announced, as a search, filter or sort change is (review of treklink-web#349).
  const [seenIds, setSeenIds] = useState(ids);
  const [dropNotice, setDropNotice] = useState({ count: 0, text: '' });
  if (seenIds !== ids) {
    setSeenIds(ids);
    const kept = keepVisible(selection, ids);
    if (kept !== selection) {
      setSelection(kept);
      setDropNotice((notice) => ({
        count: notice.count + 1,
        text: kept.selected.size === 0 ? SELECTION_CLEARED : `${kept.selected.size} selected`,
      }));
    }
  }

  // Focus returns to the next item when the focused one left the result set (§9.6 rule 5).
  useEffect(() => {
    const last = lastFocus.current;
    if (!last || ids.includes(last.id)) return;
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    const nextId = ids[Math.min(last.index, ids.length - 1)];
    if (nextId === undefined) return;
    const row = document.querySelector<HTMLElement>(
      `[data-cv="${baseId}"] [data-cv-item="${CSS.escape(nextId)}"]`,
    );
    row?.querySelector<HTMLElement>('input, a[href], button')?.focus();
  }, [ids, baseId]);

  // A query changed from outside the module (a controlled query, or the page's own filters named by
  // `resetKey`) clears the selection as well; changes made in the command bar clear it in changeQuery.
  const signature = [
    query.search,
    query.filter,
    query.sort ? `${query.sort.key}:${query.sort.direction}` : '',
    resetKey ?? '',
  ].join('|');
  const [external, setExternal] = useState({ signature, cleared: 0 });
  if (external.signature !== signature) {
    const clear = selection.selected.size > 0;
    setExternal({ signature, cleared: external.cleared + (clear ? 1 : 0) });
    if (clear) setSelection(EMPTY_SELECTION);
  }
  useEffect(() => {
    if (external.cleared > 0) announce(SELECTION_CLEARED);
  }, [external.cleared, announce]);

  const selectedItems = [...selection.selected]
    .map((id) => byId.get(id))
    .filter((item): item is T => item !== undefined);
  const selectedCount = selectedItems.length;

  const announceSelection = (next: SelectionState) => {
    announce(next.selected.size === 0 ? SELECTION_CLEARED : `${next.selected.size} selected`);
  };

  const applySelection = (next: SelectionState) => {
    setSelection(next);
    announceSelection(next);
  };

  const clearSelection = () => applySelection(EMPTY_SELECTION);

  const filterOf = (key: string) => filters?.find((each) => each.key === key);
  const sortName = (sort: CollectionSort | null) => {
    const field = sort ? fields.find((each) => each.key === sort.key) : undefined;
    return field && sort
      ? `${field.label}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}`
      : 'Default order';
  };

  const resultText = (count: number) =>
    pageInfo
      ? `${countText(pageInfo.total, noun)}, showing ${pageInfo.from} to ${pageInfo.to}`
      : countText(count, noun);

  // Search, filter and sort changes clear the selection and are announced (§9.4 rule 4, §9.7).
  const changeQuery = (patch: Partial<CollectionQuery>) => {
    const next = { ...query, ...patch };
    const parts: string[] = [];
    if (selection.selected.size > 0) {
      setSelection(EMPTY_SELECTION);
      parts.push(SELECTION_CLEARED);
    }
    if (patch.sort !== undefined) parts.push(`Sorted by ${sortName(next.sort)}`);
    if (patch.filter !== undefined) parts.push(`Showing ${filterOf(next.filter)?.label ?? 'all'}`);
    if (parts.length > 0) announce(parts.join('. '));
    if (!controlledQuery) setOwnQuery(next);
    onQueryChange?.(next);
  };

  // The result count, after the items change; debounced while a search is typed.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (items === undefined) return;
    const text = resultText(visible.length);
    if (announced.current === null) {
      announced.current = text;
      return;
    }
    if (announced.current === text) return;
    announced.current = text;
    announce(text, { debounce: query.search ? SEARCH_ANNOUNCE_MS : undefined });
    // resultText reads pageInfo and noun only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, visible.length, pageInfo?.total, pageInfo?.from, pageInfo?.to, query.search, announce]);

  // A selection a page change narrowed or cleared, announced after the result count of the same
  // change and together with it, so neither message replaces the other.
  useEffect(() => {
    if (dropNotice.count === 0) return;
    const count = resultText(visible.length);
    announced.current = count;
    announce(`${dropNotice.text}. ${count}`);
    // resultText reads pageInfo and noun only; this runs once per drop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropNotice, announce]);

  const toggle = (id: string, range: boolean) => applySelection(toggleItem(selection, id, ids, range));

  const switchView = (next: CollectionViewKey) => {
    setChosenView(next);
    announce(`${VIEW_LABEL[next]} view`);
  };

  // Inside a CollectionPaneHost, one list at a time owns the shared pane (§10.8 paneHost).
  const host = usePaneHost();
  const ownsPane = host === null || host.owner === baseId;
  useEffect(() => {
    if (!host) return undefined;
    const { release } = host;
    return () => release(baseId);
    // Release once, on unmount; the host's functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showDetails = (item: T) => (onShowDetails ? onShowDetails(item) : openDetails(item));

  const openDetails = (item: T) => {
    setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPaneId(itemId(item));
    setPaneOpen(true);
    host?.claim(baseId);
  };
  const openPane = () => {
    setPaneOpen(true);
    host?.claim(baseId);
  };
  const closeDetails = () => {
    setPaneOpen(false);
    host?.release(baseId);
    if (wide) opener?.focus();
  };
  const paneItem =
    (paneId !== null ? byId.get(paneId) : undefined) ?? selectedItems[0] ?? visible[0];
  const paneVisible = showPane && paneOpen && ownsPane && paneItem !== undefined;
  const placement: PanePlacement = wide ? 'aside' : tablet ? 'drawer' : 'sheet';
  // Pushed aside: this list's pane, or in a host any list's pane, sits beside the rows, so the
  // columns it shows and the Status change column leave and the rows never scroll sideways.
  const pushedAside = placement === 'aside' && (host ? host.owner !== null : paneVisible);
  const fitsNarrow = fitNarrow || host !== null || pushedAside;

  const actionsOf = (item: T) =>
    itemActions.filter((action) => !action.allowed || action.allowed(item));
  const transitionsOf = (item: T) => transitions?.(item) ?? [];

  const searching = query.search.trim() !== '';
  const filtered = searching || (filters !== undefined && query.filter !== firstFilter);
  const itemCount = items?.length ?? 0;
  const barHidden =
    hideCommandBar ??
    (!serverSide && itemCount <= 2 && !filtered && bulkActions.length === 0 && commands.length === 0);

  // Bulk transitions: only those allowed for every selected item (§9.6 rule 6).
  const bulkTransitions = (() => {
    if (!transitions || selectedCount === 0) return [];
    const [first, ...rest] = selectedItems.map(transitionsOf);
    return first.filter((transition) =>
      rest.every((list) => list.some((other) => other.key === transition.key)),
    );
  })();
  const bulk = bulkActions
    .map((action) => {
      const targets = action.appliesTo ? selectedItems.filter(action.appliesTo) : selectedItems;
      return { action, targets };
    })
    .filter((entry) => entry.targets.length > 0);

  // Remembers the focused item, so focus can move to the next one if it leaves the result set.
  const noteFocus = (event: React.FocusEvent<HTMLElement>) => {
    const { cvItem, cvIndex } = event.currentTarget.dataset;
    if (cvItem !== undefined) lastFocus.current = { id: cvItem, index: Number(cvIndex ?? 0) };
  };

  const onRegionKeyDown = (event: React.KeyboardEvent) => {
    // Escape closes the innermost layer first; tooltips, menus, dialogs and the pane handle it and
    // mark it handled. What reaches here clears the selection (§9.4 rule 5).
    if (event.key === 'Escape' && !event.defaultPrevented && selection.selected.size > 0) {
      event.preventDefault();
      clearSelection();
    }
  };


  // ----- pieces shared by every view -----

  const checkbox = (item: T) => {
    const id = itemId(item);
    return (
      <ItemCheckbox
        name={`Select ${itemName(item)}`}
        checked={selection.selected.has(id)}
        onToggle={(range) => toggle(id, range)}
      />
    );
  };

  const titleOf = (item: T, className?: string) => {
    if (itemTitle) return itemTitle(item);
    const href = itemHref?.(item);
    return href ? (
      <Link to={href} className={cn(LINK, 'inline-flex min-h-6 items-center', className)}>
        {itemName(item)}
      </Link>
    ) : (
      <span className={cn('font-semibold text-ink', className)}>{itemName(item)}</span>
    );
  };

  const detailsButton = (item: T) =>
    offersDetails ? (
      <TooltipButton
        key="details"
        tooltip="Show details"
        name={`Show details of ${itemName(item)}`}
        icon={<Info />}
        pressed={
          showPane
            ? paneVisible && paneItem !== undefined && itemId(paneItem) === itemId(item)
            : undefined
        }
        onClick={() => showDetails(item)}
      />
    ) : null;

  const actionButtons = (item: T) => (
    <span className="flex items-center justify-end gap-0.5">
      {detailsButton(item)}
      {actionsOf(item).map((action) => (
        <TooltipButton
          key={action.key}
          tooltip={action.label}
          name={action.accessibleName?.(item) ?? `${action.label} ${itemName(item)}`}
          icon={action.icon}
          unavailableReason={action.unavailableReason?.(item)}
          onClick={() => action.onSelect(item)}
        />
      ))}
    </span>
  );

  // At phone width an item's actions and status changes are one Actions dropdown (§10.5).
  const phoneMenu = (item: T) => {
    const name = itemName(item);
    const plain: MenuItem[] = [
      ...(offersDetails
        ? [{ key: 'details', label: 'Show details', onSelect: () => showDetails(item) }]
        : []),
      ...actionsOf(item).map((action) => ({
        key: action.key,
        label: action.label,
        destructive: action.destructive,
        disabled: action.unavailableReason?.(item) !== undefined,
        disabledReason: action.unavailableReason?.(item),
        onSelect: () => action.onSelect(item),
      })),
      ...transitionsOf(item).map((transition) => ({
        key: `status-${transition.key}`,
        label: `Change status: ${transition.label}`,
        destructive: transition.destructive,
        onSelect: () => transition.onSelect([item]),
      })),
    ];
    const ordered = [...plain.filter((each) => !each.destructive), ...plain.filter((each) => each.destructive)];
    const firstDestructive = ordered.findIndex((each) => each.destructive);
    if (ordered.length === 0) return null;
    return (
      <Menu
        label={`Actions for ${name}`}
        trigger={<span>Actions</span>}
        triggerClassName={MENU_TRIGGER}
        items={ordered.map((each, index) => ({ ...each, separatorBefore: index === firstDestructive }))}
      />
    );
  };

  const statusMenu = (item: T) => (
    <StatusMenu
      item={item}
      itemName={itemName(item)}
      statusText={statusOf?.(item)}
      transitions={transitionsOf(item)}
    />
  );

  // ----- command bar -----

  const pageState = pageSelection(selection.selected, ids);
  const selectAll = selectable && ids.length > 0 && (
    <label className="flex h-11 shrink-0 cursor-pointer items-center gap-2 pr-1">
      <input
        type="checkbox"
        className={cn('h-6 w-6 cursor-pointer accent-[rgb(var(--tl-accent))]', FOCUS)}
        aria-label={`Select all ${countText(ids.length, noun)} on this page`}
        checked={pageState === 'all'}
        ref={(node) => {
          if (node) node.indeterminate = pageState === 'some';
        }}
        onChange={() => applySelection(toggleAll(selection, ids))}
      />
      <span aria-hidden="true" className="text-body-sm font-semibold text-ink">
        {phone ? 'All' : 'Select all'}
      </span>
    </label>
  );

  const clearButton = selectedCount > 0 && (
    <Button
      size="sm"
      variant="secondary"
      icon={<X className="h-4 w-4" />}
      aria-label={`Clear selection, ${selectedCount} selected`}
      onClick={clearSelection}
    >
      {selectedCount} selected
    </Button>
  );

  const filterItems: MenuItem[] = (filters ?? []).map((filter) => ({
    key: `filter-${filter.key}`,
    label: `${filter.label}${filter.key === query.filter ? ' (current)' : ''}`,
    onSelect: () => changeQuery({ filter: filter.key }),
  }));
  const sortable = fields.filter((field) => field.sortable);
  const sortItems: MenuItem[] = sortable.flatMap((field) =>
    (['asc', 'desc'] as const).map((direction) => {
      const current = query.sort?.key === field.key && query.sort.direction === direction;
      return {
        key: `sort-${field.key}-${direction}`,
        label: `${field.label}, ${direction === 'asc' ? 'ascending' : 'descending'}${current ? ' (current)' : ''}`,
        onSelect: () => changeQuery({ sort: { key: field.key, direction } }),
      };
    }),
  );
  const currentFilter = filterOf(query.filter);
  const resultCount = pageInfo?.total ?? visible.length;
  const showText = `Show: ${currentFilter?.label ?? 'All'}, ${resultCount}`;
  const sortShort = query.sort
    ? (fields.find((field) => field.key === query.sort?.key)?.label ?? 'Default')
    : 'Default';
  const sortText = `Sort: ${sortShort}`;

  const viewIndex = views.indexOf(view);
  const nextView = views[(viewIndex + 1) % views.length];
  const viewSwitch = views.length > 1 && (
    <span
      role="group"
      aria-label="View"
      className="inline-flex shrink-0 items-center rounded-control border border-line-strong bg-surface"
    >
      <TooltipButton
        tooltip={`View: ${VIEW_LABEL[view]}. Switch to ${VIEW_LABEL[nextView]}`}
        name={`View: ${VIEW_LABEL[view]}. Switch to ${VIEW_LABEL[nextView]}`}
        icon={VIEW_ICON[view]}
        onClick={() => switchView(nextView)}
      />
      <span aria-hidden="true" className="h-6 w-px bg-line" />
      <Menu
        label="Choose view"
        trigger={<></>}
        triggerClassName="h-10 px-2"
        items={views.map((key) => ({
          key: `view-${key}`,
          label: `${VIEW_LABEL[key]}${key === view ? ' (current)' : ''}`,
          icon: VIEW_ICON[key],
          onSelect: () => switchView(key),
        }))}
      />
    </span>
  );

  const searchField = search && (
    <>
      <label htmlFor={searchId} className="shrink-0 text-body-sm font-semibold text-ink">
        Search
      </label>
      <input
        id={searchId}
        type="search"
        aria-label={search.label}
        placeholder={search.placeholder}
        value={query.search}
        onChange={(event) => changeQuery({ search: event.target.value })}
        className={cn(
          'h-10 min-w-0 flex-[0_1_12rem] rounded-control border border-line-strong bg-surface px-3 text-body text-ink',
          FOCUS,
          phone && 'flex-1',
        )}
      />
      {searching && !phone && (
        <span className="shrink-0 text-body-sm tabular-nums text-ink-muted">
          {visible.length} {visible.length === 1 ? 'match' : 'matches'}
        </span>
      )}
    </>
  );

  const commandButtons = commands.map((command) => (
    <TooltipButton
      key={command.key}
      tooltip={command.label}
      name={command.label}
      icon={command.icon}
      shortLabel={phone ? undefined : command.shortLabel}
      disabled={command.disabled}
      align="start"
      onClick={command.onSelect}
    />
  ));

  const bulkButtons = bulk.map(({ action, targets }) => {
    const text = action.label(targets.length);
    return action.icon ? (
      <TooltipButton
        key={action.key}
        tooltip={text}
        name={text}
        icon={action.icon}
        shortLabel={text}
        align="start"
        onClick={() => action.onSelect(targets)}
      />
    ) : (
      <Button
        key={action.key}
        size="sm"
        variant={action.destructive ? 'danger' : 'secondary'}
        onClick={() => action.onSelect(targets)}
      >
        {text}
      </Button>
    );
  });

  const bulkStatus = bulkTransitions.length > 0 && (
    <StatusMenu
      items={selectedItems}
      itemName={countText(selectedCount, noun)}
      transitions={bulkTransitions}
      label="Change status"
      align="start"
    />
  );

  const paneToggle = showPane && (
    <TooltipButton
      tooltip={paneVisible ? 'Hide details pane' : 'Show details pane'}
      name="Details pane"
      icon={<PanelRight />}
      pressed={paneVisible}
      onClick={() => (paneVisible ? closeDetails() : openPane())}
    />
  );

  const wideBar = (
    <>
      {selectAll}
      {selectable && ids.length > 0 && <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />}
      {selectedCount === 0 ? commandButtons : (
        <>
          {clearButton}
          {bulkStatus}
          {bulkButtons}
        </>
      )}
      <span className="min-w-2 flex-1" />
      {searchField}
      {filters && filters.length > 0 && (
        <Menu
          label={`${showText}. Change what is shown`}
          trigger={<span>{showText}</span>}
          triggerClassName={MENU_TRIGGER}
          items={filterItems}
        />
      )}
      {sortable.length > 0 && (
        <Menu
          label={`${sortText}. ${sortName(query.sort)}. Change sort`}
          trigger={<span>{sortText}</span>}
          triggerClassName={MENU_TRIGGER}
          items={sortItems}
        />
      )}
      {viewSwitch}
      {paneToggle}
    </>
  );

  // Phone: one row (§10.5). The Sort dropdown also holds the Show filters; a selection shows its
  // count and one Actions dropdown.
  const phoneBulkItems: MenuItem[] = [
    ...bulk.map(({ action, targets }) => ({
      key: action.key,
      label: action.label(targets.length),
      destructive: action.destructive,
      onSelect: () => action.onSelect(targets),
    })),
    ...bulkTransitions.map((transition) => ({
      key: `status-${transition.key}`,
      label: `Change status: ${transition.label}`,
      destructive: transition.destructive,
      onSelect: () => transition.onSelect(selectedItems),
    })),
  ];
  const phoneBar = searchOpen && search ? (
    <>
      {searchField}
      <TooltipButton
        tooltip="Close search"
        name="Close search"
        icon={<X />}
        onClick={() => setSearchOpen(false)}
      />
    </>
  ) : (
    <>
      {selectAll}
      {selectedCount === 0 ? (
        <>
          {commandButtons}
          <span className="min-w-1 flex-1" />
          {search && (
            <TooltipButton
              tooltip={search.label}
              name={search.label}
              icon={<Search />}
              onClick={() => setSearchOpen(true)}
            />
          )}
          {(sortItems.length > 0 || filterItems.length > 0) && (
            <Menu
              label={`${sortText}. ${showText}. Change sort or filter`}
              trigger={<span>Sort</span>}
              triggerClassName={MENU_TRIGGER}
              items={[
                ...sortItems,
                ...filterItems.map((each, index) => ({
                  ...each,
                  label: `Show ${each.label}`,
                  separatorBefore: index === 0 && sortItems.length > 0,
                })),
              ]}
            />
          )}
          {viewSwitch}
        </>
      ) : (
        <>
          {clearButton}
          <span className="min-w-1 flex-1" />
          {phoneBulkItems.length > 0 && (
            <Menu
              label={`Actions for ${countText(selectedCount, noun)}`}
              trigger={<span>Actions</span>}
              triggerClassName={MENU_TRIGGER}
              items={[
                ...phoneBulkItems.filter((each) => !each.destructive),
                ...phoneBulkItems.filter((each) => each.destructive),
              ]}
            />
          )}
        </>
      )}
    </>
  );

  // ----- views -----

  const tableFields = fields.filter((field) => !(pushedAside && field.hideWithPane));
  const narrowHide = (field: CollectionField<T>) =>
    fitsNarrow && field.hideWithPane ? '[@container(max-width:1099px)]:hidden' : undefined;
  const statusColumn = transitions !== undefined && !pushedAside && !phone;
  const actionsColumn = !phone && (offersDetails || itemActions.length > 0);

  const detailsView = (
    <div className="relative">
      <ScrollHintOverlay hints={pushedAside ? { ...tableHints, left: false, right: false } : tableHints} />
      <div
        ref={tableScroller}
        className={cn(
          'relative rounded-panel border border-line bg-surface shadow-raise',
          pushedAside ? 'overflow-x-hidden' : 'overflow-x-auto',
        )}
      >
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="bg-sunken text-left">
              {selectable && (
                <th scope="col" className="w-11 p-0">
                  <span className="sr-only">Selection</span>
                </th>
              )}
              <th scope="col" className="px-3 py-2 text-label uppercase text-ink-muted" aria-sort={ariaSort('__title')}>
                {noun.one.charAt(0).toUpperCase() + noun.one.slice(1)}
              </th>
              {tableFields.map((field) => (
                <th
                  key={field.key}
                  scope="col"
                  aria-sort={ariaSort(field.key)}
                  className={cn(
                    'px-3 py-2 text-label uppercase text-ink-muted',
                    field.align === 'end' && 'text-right',
                    narrowHide(field),
                  )}
                >
                  {field.sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        changeQuery({
                          sort: {
                            key: field.key,
                            direction:
                              query.sort?.key === field.key && query.sort.direction === 'asc' ? 'desc' : 'asc',
                          },
                        })
                      }
                      className={cn(
                        'inline-flex min-h-6 items-center gap-1 rounded-sm uppercase hover:text-ink',
                        FOCUS,
                        query.sort?.key === field.key && 'text-ink',
                      )}
                    >
                      {field.label}
                      {query.sort?.key === field.key ? (
                        query.sort.direction === 'asc' ? (
                          <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    field.label
                  )}
                </th>
              ))}
              {statusColumn && (
                <th scope="col" className="px-3 py-2 text-label uppercase text-ink-muted">
                  Status change
                </th>
              )}
              {actionsColumn && (
                <th scope="col" className="px-3 py-2 text-right text-label uppercase text-ink-muted">
                  Actions
                </th>
              )}
              {phone && (
                <th scope="col" className="px-3 py-2 text-right text-label uppercase text-ink-muted">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((item, index) => {
              const id = itemId(item);
              const selected = selection.selected.has(id);
              return (
                <tr
                  key={id}
                  data-cv-item={id}
                  data-cv-index={index}
            onFocusCapture={noteFocus}
                  className={cn('border-t border-line', selected && 'bg-chrome/60')}
                >
                  {selectable && <td className="p-0">{checkbox(item)}</td>}
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    {titleOf(item)}
                  </th>
                  {tableFields.map((field) => (
                    <td
                      key={field.key}
                      className={cn(
                        'px-3 py-1.5 align-middle text-ink',
                        field.align === 'end' && 'text-right tabular-nums',
                        narrowHide(field),
                      )}
                    >
                      {field.render(item)}
                    </td>
                  ))}
                  {statusColumn && <td className="whitespace-nowrap px-3 py-1">{statusMenu(item)}</td>}
                  {actionsColumn && <td className="whitespace-nowrap px-2 py-1">{actionButtons(item)}</td>}
                  {phone && <td className="whitespace-nowrap px-2 py-1 text-right">{phoneMenu(item)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  function ariaSort(key: string): 'ascending' | 'descending' | undefined {
    if (query.sort?.key !== key) return undefined;
    return query.sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  const compactFields = fields.filter((field) => field.compact);

  const list = (
    <ul aria-label={label} className="flex flex-col rounded-panel border border-line bg-surface shadow-raise">
      {visible.map((item, index) => {
        const id = itemId(item);
        return (
          <li
            key={id}
            data-cv-item={id}
            data-cv-index={index}
            onFocusCapture={noteFocus}
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1 border-line px-2 py-1.5 [&+&]:border-t',
              selection.selected.has(id) && 'bg-chrome/60',
            )}
          >
            {selectable && checkbox(item)}
            <span className="min-w-0 flex-[1_1_8rem]">{titleOf(item)}</span>
            <span className="flex min-w-0 flex-[2_1_12rem] flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink">
              {compactFields.map((field) => (
                <span key={field.key} className="min-w-0">
                  {field.render(item)}
                </span>
              ))}
            </span>
            {phone ? (
              phoneMenu(item)
            ) : (
              <span className="ml-auto flex items-center gap-1">
                {statusMenu(item)}
                {actionButtons(item)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );

  const cards = (
    <ul aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
      {visible.map((item, index) => {
        const id = itemId(item);
        return (
          <li
            key={id}
            data-cv-item={id}
            data-cv-index={index}
            onFocusCapture={noteFocus}
            className={cn(
              'flex flex-col gap-2 rounded-panel border border-line bg-surface p-3 shadow-raise',
              selection.selected.has(id) && 'border-accent bg-chrome/40',
            )}
          >
            <div className="flex items-center gap-1">
              {selectable && checkbox(item)}
              <h3 className="min-w-0 flex-1 text-body font-semibold">{titleOf(item)}</h3>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-sm">
              {(compactFields.length > 0 ? compactFields : fields).map((field) => (
                <React.Fragment key={field.key}>
                  <dt className="text-ink-muted">{field.label}</dt>
                  <dd className="min-w-0 text-ink">{field.render(item)}</dd>
                </React.Fragment>
              ))}
            </dl>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-1">
              {phone ? phoneMenu(item) : (
                <>
                  {statusMenu(item)}
                  {actionButtons(item)}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const body = (() => {
    if (error) return error;
    if (loading || items === undefined)
      return (
        <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3" aria-busy="true">
          <span className="sr-only">Loading {noun.other}</span>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      );
    if (visible.length === 0)
      return (
        <div className="rounded-panel border border-line bg-surface">
          {filtered ? (
            <EmptyState
              title={NO_MATCHES}
              action={
                <Button onClick={() => changeQuery({ search: '', filter: firstFilter })}>
                  Clear search and filter
                </Button>
              }
            />
          ) : (
            <EmptyState {...emptyState} />
          )}
        </div>
      );
    return view === 'details' ? detailsView : view === 'cards' ? cards : list;
  })();

  // A hosted pane that is pushed aside renders in the host's slot, beside every list of the host.
  const renderPane = (pane: React.ReactElement) =>
    host?.slot && placement === 'aside' ? createPortal(pane, host.slot) : pane;

  return (
    <section
      aria-label={label}
      data-cv={baseId}
      onKeyDown={onRegionKeyDown}
      className={cn('flex flex-col gap-2', fitsNarrow && '[container-type:inline-size]', className)}
    >
      {!barHidden && (
        <div
          ref={setBarNode}
          style={{ top: stickyTop ?? 'var(--tl-page-header-h, 0px)' }}
          className="sticky z-raised rounded-panel border border-line bg-surface shadow-raise"
        >
          <div
            role="group"
            aria-label={`${label}: commands`}
            className="flex min-h-[3.25rem] flex-nowrap items-center gap-1.5 px-2 py-1"
          >
            {phone ? phoneBar : wideBar}
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
      <div className={cn('flex items-start gap-3', pushedAside && 'min-w-0')}>
        <div className="min-w-0 flex-1">
          {body}
          {footer && <div className="mt-2">{footer}</div>}
        </div>
        {paneVisible && paneItem !== undefined && renderPane(
          <DetailsPane
            item={paneItem}
            itemName={itemName(paneItem)}
            placement={placement}
            fields={fields}
            details={details || undefined}
            actions={actionsOf(paneItem)}
            transitions={transitionsOf(paneItem)}
            statusText={statusOf?.(paneItem)}
            onClose={closeDetails}
          />,
        )}
      </div>
    </section>
  );
}

/**
 * The checkbox of one item (§9.4, §10.7): 24 px inside a 44 px label. Click or Space toggles it;
 * Shift with either selects the range from the anchor. A keyboard click carries no reliable Shift
 * state, so Space with Shift is remembered from keydown.
 */
const ItemCheckbox: React.FC<{
  name: string;
  checked: boolean;
  onToggle: (range: boolean) => void;
}> = ({ name, checked, onToggle }) => {
  const shift = useRef(false);
  return (
    <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        className={cn('h-6 w-6 cursor-pointer accent-[rgb(var(--tl-accent))]', FOCUS)}
        aria-label={name}
        checked={checked}
        onChange={() => undefined}
        onKeyDown={(event) => {
          if (event.key === ' ') shift.current = event.shiftKey;
        }}
        onKeyUp={() => {
          shift.current = false;
        }}
        onClick={(event) => {
          const range = event.shiftKey || shift.current;
          shift.current = false;
          onToggle(range);
        }}
      />
    </label>
  );
};
