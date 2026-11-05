import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Grid2x2,
  Grid3x3,
  Info,
  LayoutGrid,
  MoreHorizontal,
  PanelRight,
  Search,
  Square,
  Table2,
  X,
} from 'lucide-react';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Button } from '../Button';
import { cn } from '../cn';
import { EmptyState } from '../EmptyState';
import { Menu, type MenuItem } from '../Menu';
import { ScrollHintOverlay } from '../ScrollHints';
import { useScrollHints } from '../useScrollHints';
import { useScrollStop } from '../scrollStop';
import { Skeleton } from '../Skeleton';
import { ariaSortOf, nextSort } from '../sortCycle';
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
import { StatusBadgeMenu } from './StatusBadgeMenu';
import { TooltipButton } from './TooltipButton';
import type {
  CollectionAction,
  CollectionBulkAction,
  CollectionCommand,
  CollectionDetails,
  CollectionEmptyState,
  CollectionField,
  CollectionFilter,
  CollectionFilterGroup,
  CollectionNoun,
  CollectionPageInfo,
  CollectionQuery,
  CollectionSort,
  CollectionStatus,
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

// The views every collection offers, in the order the View button cycles them (chapter 06 §9.2, W30).
// The Claude Design canvas "Contract Home" draws the table icon for the Details list and the square
// for Large cards.
const COLLECTION_VIEWS: readonly CollectionViewKey[] = ['details', 'grid', 'smallCards', 'mediumCards', 'largeCards'];

const VIEW_LABEL: Record<CollectionViewKey, string> = {
  details: 'Details list',
  grid: 'Grid',
  smallCards: 'Small cards',
  mediumCards: 'Medium cards',
  largeCards: 'Large cards',
};

const VIEW_ICON: Record<CollectionViewKey, React.ReactNode> = {
  details: <Table2 />,
  grid: <LayoutGrid />,
  smallCards: <Grid3x3 />,
  mediumCards: <Grid2x2 />,
  largeCards: <Square />,
};

type CardViewKey = Exclude<CollectionViewKey, 'details'>;

// One card anatomy at four scales (W30, the Large card of the canvas scaled down): the columns follow
// the width of the item box, not the window, so a list beside the details pane keeps readable cards.
const CARD_LAYOUT: Record<
  CardViewKey,
  { columns: string; tile: string; icon: string; card: string; heading: string; fields: boolean; subtitle: boolean }
> = {
  largeCards: {
    columns:
      'grid-cols-1 [@container(min-width:30rem)]:grid-cols-2 [@container(min-width:46rem)]:grid-cols-3 [@container(min-width:60rem)]:grid-cols-4',
    tile: 'h-[4.5rem] w-[4.5rem]',
    icon: '[&>svg]:h-8 [&>svg]:w-8',
    card: 'gap-3 p-3',
    heading: 'text-body',
    fields: true,
    subtitle: true,
  },
  mediumCards: {
    columns:
      'grid-cols-1 [@container(min-width:24rem)]:grid-cols-2 [@container(min-width:38rem)]:grid-cols-3 [@container(min-width:50rem)]:grid-cols-4 [@container(min-width:64rem)]:grid-cols-5',
    tile: 'h-12 w-12',
    icon: '[&>svg]:h-6 [&>svg]:w-6',
    card: 'gap-2 p-2.5',
    heading: 'text-body-sm',
    fields: true,
    subtitle: true,
  },
  smallCards: {
    columns:
      'grid-cols-1 [@container(min-width:20rem)]:grid-cols-2 [@container(min-width:34rem)]:grid-cols-3 [@container(min-width:46rem)]:grid-cols-4 [@container(min-width:60rem)]:grid-cols-6',
    tile: 'h-8 w-8',
    icon: '[&>svg]:h-5 [&>svg]:w-5',
    card: 'gap-1.5 p-2',
    heading: 'text-body-sm',
    fields: false,
    subtitle: false,
  },
  grid: {
    columns:
      'grid-cols-2 [@container(min-width:24rem)]:grid-cols-3 [@container(min-width:36rem)]:grid-cols-4 [@container(min-width:50rem)]:grid-cols-6 [@container(min-width:66rem)]:grid-cols-8',
    tile: 'h-16 w-16',
    icon: '[&>svg]:h-8 [&>svg]:w-8',
    card: 'gap-1.5 p-2',
    heading: 'text-body-sm',
    fields: false,
    subtitle: false,
  },
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
  /**
   * The transitions' `onSelect` handles every item it is given, so a selection may change status
   * together (§9.6 rule 6). Without it a transition is offered per item only, and the transitions do
   * not make the list selectable (review of treklink-web#350).
   */
  bulkTransitions?: boolean;
  /**
   * A newer copy of an item than the list holds, by id: the result of a change the page just made,
   * before or after the item leaves the list. The details pane shows it (review of treklink-web#350).
   */
  freshItem?: (id: string) => T | undefined;
  /**
   * The status field (§11.3): its cell shows the status badge, and when `transitions` allows a change
   * the badge itself is the menu button. No separate Status change column is drawn.
   */
  status?: CollectionStatus<T>;
  bulkActions?: CollectionBulkAction<T>[];
  commands?: CollectionCommand[];
  /** The view from 600 px up, the Details list by default; below it a collection opens on Large cards (W30). */
  defaultView?: CollectionViewKey;
  /**
   * The image tile of a Large card: a device's variant render from `public/variants/` (W30). Without
   * it the tile shows `icon`.
   */
  cardImage?: (item: T) => React.ReactNode;
  /** The lines under a Large card's heading: for a device, the variant name and its capabilities. */
  cardSubtitle?: (item: T) => React.ReactNode;
  /** The collection's icon, drawn large in the tile of a card with no image. */
  icon?: React.ReactNode;
  /** The details pane of §9.8; false leaves it out. */
  details?: CollectionDetails<T> | false;
  /**
   * A page's own record view (a drawer with its own actions) in place of the built-in pane: Show
   * details stays the first item action and opens it, and the command bar has no pane toggle.
   */
  onShowDetails?: (item: T) => void;
  emptyState: CollectionEmptyState;
  /** The page's own words for a search or filter that finds nothing; the clear button stays. */
  noMatch?: Pick<CollectionEmptyState, 'title' | 'description'>;
  search?: { label: string; placeholder?: string };
  filters?: CollectionFilter<T>[];
  /** Server filters that combine with the Show filter, listed in the same menu. */
  filterGroups?: CollectionFilterGroup<T>[];
  /** A controlled query. With `onQueryChange` the page filters, searches and sorts on the server. */
  query?: CollectionQuery;
  /**
   * The list's default order when it is a column (the sync ledger by received time, newest first):
   * that header toggles only its two directions (chapter 06 §11.2). A `null` query sort means it.
   */
  defaultSort?: CollectionSort;
  /**
   * The sort key of the title column (the asset tag, code or number): its header then sorts like a
   * sortable field, under the noun as its label, and the client-side sort reads `itemName` (W26).
   */
  titleSort?: string;
  onQueryChange?: (query: CollectionQuery) => void;
  pageInfo?: CollectionPageInfo;
  loading?: boolean;
  error?: React.ReactNode;
  /** Pagination, under the items. */
  footer?: React.ReactNode;
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
  bulkTransitions: transitionsApplyToSelection = false,
  freshItem,
  status,
  bulkActions = [],
  commands = [],
  defaultView,
  cardImage,
  cardSubtitle,
  icon,
  details = {},
  onShowDetails,
  emptyState,
  noMatch,
  search,
  filters,
  filterGroups,
  query: controlledQuery,
  defaultSort,
  titleSort,
  onQueryChange,
  pageInfo,
  loading,
  error,
  footer,
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
  const view: CollectionViewKey = chosenView ?? (phone ? 'largeCards' : (defaultView ?? 'details'));
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [paneId, setPaneId] = useState<string | null>(null);
  // The item the pane was opened on, kept while it leaves the list (a request just decided leaves
  // its queue), so the pane never jumps to another record (review of treklink-web#350).
  const [paneHeld, setPaneHeld] = useState<T | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { message, announce } = useLiveRegion();
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const lastFocus = useRef<{ id: string; index: number } | null>(null);
  const tableScroller = useRef<HTMLDivElement | null>(null);
  const tableHints = useScrollHints(tableScroller);
  // The item box is the scroll region on a fit page; with nothing focusable in it, it takes a tab
  // stop and a name of its own (ui standard §7).
  const [tableNode, setTableNode] = useState<HTMLDivElement | null>(null);
  const setTableScroller = useCallback((node: HTMLDivElement | null) => {
    tableScroller.current = node;
    setTableNode(node);
  }, []);
  const [itemBox, setItemBox] = useState<HTMLDivElement | null>(null);
  useScrollStop(tableNode, `${label}: table`);
  useScrollStop(itemBox, label);

  // A list of one or two records with nothing to filter, sort or switch hides its command bar
  // (§9.3); its item actions stay, and with no bar there is nothing to select for.
  const groups = filterGroups ?? [];
  const groupValue = (group: CollectionFilterGroup<T>) =>
    query.groups?.[group.key] ?? group.options[0]?.key ?? '';
  const groupsNarrowed = groups.some((group) => groupValue(group) !== group.options[0]?.key);
  const narrowed =
    query.search.trim() !== '' ||
    (filters !== undefined && query.filter !== firstFilter) ||
    groupsNarrowed;
  const recordCount = pageInfo?.total ?? items?.length ?? 0;
  // A server-paged list keeps its bar: its filters and pages reach past the rows shown (review of
  // treklink-web#350).
  const barHidden =
    hideCommandBar ??
    (!serverSide && items !== undefined && recordCount <= 2 && commands.length === 0 && !narrowed);
  const selectable =
    (bulkActions.length > 0 || (transitions !== undefined && transitionsApplyToSelection)) &&
    !barHidden;
  const showPane = details !== false && onShowDetails === undefined;
  const offersDetails = showPane || onShowDetails !== undefined;

  // The visible items: a server-paged collection shows the page as given; a client collection
  // filters, searches and sorts the items it holds.
  const visible = useMemo(() => {
    const all = items ?? [];
    if (serverSide) return all;
    const filter = filters?.find((each) => each.key === query.filter);
    const groupTests = (filterGroups ?? []).flatMap((group) => {
      const value = query.groups?.[group.key] ?? group.options[0]?.key;
      const chosen = group.options.find((option) => option.key === value);
      return chosen?.test ? [chosen.test] : [];
    });
    const needle = query.search.trim().toLowerCase();
    const searched = all.filter(
      (item) =>
        (!filter?.test || filter.test(item)) &&
        groupTests.every((test) => test(item)) &&
        (needle === '' ||
          [itemName(item), ...fields.map((field) => field.text?.(item) ?? '')]
            .join(' ')
            .toLowerCase()
            .includes(needle)),
    );
    const sort = query.sort ?? defaultSort ?? null;
    const field = sort ? fields.find((each) => each.key === sort.key) : undefined;
    const byTitle = sort !== null && titleSort !== undefined && sort.key === titleSort;
    if (!sort || (!field && !byTitle)) return searched;
    const value = (item: T) =>
      byTitle ? itemName(item) : (field?.sortValue?.(item) ?? field?.text?.(item) ?? '');
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
  }, [items, serverSide, filters, filterGroups, query, defaultSort, titleSort, fields, itemName]);

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
  const titleLabel = noun.one.charAt(0).toUpperCase() + noun.one.slice(1);
  // The columns a user may sort on: the title when it carries a sort key, then the sortable fields.
  const sortColumns = [
    ...(titleSort !== undefined ? [{ key: titleSort, label: titleLabel }] : []),
    ...fields.filter((field) => field.sortable).map(({ key, label }) => ({ key, label })),
  ];
  const sortLabelOf = (key: string) => sortColumns.find((column) => column.key === key)?.label;
  const sortName = (given: CollectionSort | null) => {
    const sort = given ?? defaultSort ?? null;
    const label = sort ? sortLabelOf(sort.key) : undefined;
    return label && sort
      ? `${label}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}`
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
    groups.forEach((group) => {
      const before = query.groups?.[group.key] ?? group.options[0]?.key;
      const after = next.groups?.[group.key] ?? group.options[0]?.key;
      if (patch.groups !== undefined && before !== after)
        parts.push(`Showing ${group.label}: ${group.options.find((option) => option.key === after)?.label ?? after}`);
    });
    if (parts.length > 0) announce(parts.join('. '));
    if (!controlledQuery) setOwnQuery(next);
    onQueryChange?.(next);
  };

  const changeGroup = (group: CollectionFilterGroup<T>, key: string) =>
    changeQuery({ groups: { ...query.groups, [group.key]: key } });
  // One query change, so a page that keeps the filters in its own state applies them together.
  const clearFilters = () => changeQuery({ search: '', filter: firstFilter, groups: {} });

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
    setPaneHeld(item);
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
  const held = paneHeld !== null && paneId !== null && itemId(paneHeld) === paneId ? paneHeld : undefined;
  const paneItem =
    (paneId !== null ? (freshItem?.(paneId) ?? byId.get(paneId) ?? held) : undefined) ??
    selectedItems[0] ??
    visible[0];
  const paneVisible = showPane && paneOpen && ownsPane && paneItem !== undefined;
  const placement: PanePlacement = wide ? 'aside' : tablet ? 'drawer' : 'sheet';
  // Pushed aside: this list's pane, or in a host any list's pane, sits beside the rows, so the
  // columns it shows and the Status change column leave and the rows never scroll sideways.
  const pushedAside = placement === 'aside' && (host ? host.owner !== null : paneVisible);
  const fitsNarrow = fitNarrow || host !== null || pushedAside;

  const actionsOf = (item: T) =>
    itemActions.filter((action) => !action.allowed || action.allowed(item));
  // The action slots of the list (§11.4): an action any shown item may take keeps its slot on every
  // row, so no button moves because another appeared. An action no item may take (the role never
  // has it) is absent for the whole list.
  const listActions = itemActions.filter(
    (action) => !action.allowed || visible.some((item) => action.allowed?.(item)),
  );
  // Why an action that holds a slot is unavailable for this item, or undefined when it is available.
  const reasonOf = (action: CollectionAction<T>, item: T) => {
    if (action.allowed && !action.allowed(item))
      return action.unavailableReason?.(item) ?? `Not available for this ${noun.one} now.`;
    return action.unavailableReason?.(item);
  };
  // The slots, in list order; actions sharing a slot key hold one slot.
  const slots = listActions.reduce<CollectionAction<T>[][]>((all, action) => {
    const key = action.slot ?? action.key;
    const found = all.find((group) => (group[0].slot ?? group[0].key) === key);
    if (found) found.push(action);
    else all.push([action]);
    return all;
  }, []);
  // The action a slot shows for this item: the first one it may take, else the first, disabled.
  const slotActions = (item: T) =>
    slots.map((group) => group.find((action) => !action.allowed || action.allowed(item)) ?? group[0]);
  // Three or more slots besides Show details share one overflow menu in a fixed slot next to it.
  const overflows = slots.length >= 3;
  const transitionsOf = (item: T) => transitions?.(item) ?? [];

  const searching = query.search.trim() !== '';
  const filtered =
    searching || (filters !== undefined && query.filter !== firstFilter) || groupsNarrowed;

  // Bulk transitions: only those allowed for every selected item (§9.6 rule 6).
  const bulkTransitions = (() => {
    if (!transitions || !transitionsApplyToSelection || selectedCount === 0) return [];
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

  // The actions cell, right-aligned, in fixed slots from the inline end (§11.4): Show details last
  // in tab order at the inline end, the overflow menu next to it for three or more actions, else the
  // actions in their list order to its left. A page adds a new action at the start of its list.
  const actionButtons = (item: T) => {
    const name = itemName(item);
    return (
      <span className="flex items-center justify-end gap-0.5">
        {overflows ? (
          <Menu
            label={`More actions for ${name}`}
            title="More actions"
            chevron={false}
            trigger={<MoreHorizontal aria-hidden="true" className="h-5 w-5" />}
            triggerClassName="h-10 min-w-10"
            items={slotActions(item).map((action) => {
              const reason = reasonOf(action, item);
              return {
                key: action.key,
                label: action.label,
                icon: action.icon,
                destructive: action.destructive,
                disabled: reason !== undefined,
                disabledReason: reason,
                onSelect: () => action.onSelect(item),
              };
            })}
          />
        ) : (
          slotActions(item).map((action) => (
            <TooltipButton
              key={action.key}
              tooltip={action.label}
              name={action.accessibleName?.(item) ?? `${action.label} ${name}`}
              icon={action.icon}
              unavailableReason={reasonOf(action, item)}
              onClick={() => action.onSelect(item)}
            />
          ))
        )}
        {detailsButton(item)}
      </span>
    );
  };

  // At phone width an item's actions and status changes are one Actions dropdown (§10.5).
  const phoneMenu = (item: T) => {
    const name = itemName(item);
    const plain: MenuItem[] = [
      ...(offersDetails
        ? [{ key: 'details', label: 'Show details', onSelect: () => showDetails(item) }]
        : []),
      ...slotActions(item).map((action) => ({
        key: action.key,
        label: action.label,
        destructive: action.destructive,
        disabled: reasonOf(action, item) !== undefined,
        disabledReason: reasonOf(action, item),
        onSelect: () => action.onSelect(item),
      })),
      // With a status field the badge menu stays on the row, so the dropdown holds no status items.
      ...(status
        ? []
        : transitionsOf(item).map((transition) => ({
            key: `status-${transition.key}`,
            label: `Change status: ${transition.label}`,
            destructive: transition.destructive,
            onSelect: () => transition.onSelect([item]),
          }))),
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

  // A list with transitions but no status field keeps the older Change status button beside the
  // actions; every page with a status column passes `status` instead (§11.3).
  const statusMenu = (item: T) =>
    status ? null : (
      <StatusMenu item={item} itemName={itemName(item)} transitions={transitionsOf(item)} />
    );

  // The status cell: the badge, which is the menu button while a transition is allowed and no
  // selection exists (§11.3), then any further badges.
  const statusCell = (item: T) => {
    if (!status) return null;
    const extra = status.extra?.(item);
    const badge = (
      <StatusBadgeMenu
        status={status.value(item)}
        itemName={itemName(item)}
        items={[item]}
        transitions={transitionsOf(item)}
        disabled={selectedCount > 0}
      />
    );
    return extra ? (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {badge}
        {extra}
      </span>
    ) : (
      badge
    );
  };
  const renderField = (field: CollectionField<T>, item: T) =>
    status && field.key === status.field ? statusCell(item) : field.render(item);

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

  const filterItems: MenuItem[] = [
    ...(filters ?? []).map((filter) => ({
      key: `filter-${filter.key}`,
      label: `${filter.label}${filter.key === query.filter ? ' (current)' : ''}`,
      onSelect: () => changeQuery({ filter: filter.key }),
    })),
    ...groups.flatMap((group) =>
      group.options.map((option, index) => ({
        key: `group-${group.key}-${option.key}`,
        label: `${group.label}: ${option.label}${option.key === groupValue(group) ? ' (current)' : ''}`,
        separatorBefore: index === 0,
        onSelect: () => changeGroup(group, option.key),
      })),
    ),
  ];
  const activeSort = query.sort ?? defaultSort ?? null;
  // The Sort dropdown offers the orders the headers cycle through, for the phone and card views
  // (§11.2): each column's two directions, and the default order when it is not a column.
  const defaultItem: MenuItem[] =
    sortColumns.length > 0 && !defaultSort
      ? [
          {
            key: 'sort-default',
            label: `Default order${query.sort === null ? ' (current)' : ''}`,
            onSelect: () => changeQuery({ sort: null }),
          },
        ]
      : [];
  const sortItems: MenuItem[] = [...defaultItem, ...sortColumns.flatMap((field) =>
    (['asc', 'desc'] as const).map((direction) => {
      const current = activeSort?.key === field.key && activeSort.direction === direction;
      return {
        key: `sort-${field.key}-${direction}`,
        label: `${field.label}, ${direction === 'asc' ? 'ascending' : 'descending'}${current ? ' (current)' : ''}`,
        onSelect: () => changeQuery({ sort: { key: field.key, direction } }),
      };
    }),
  )];
  const currentFilter = filterOf(query.filter);
  const resultCount = pageInfo?.total ?? visible.length;
  const showText = `Show: ${[
    currentFilter?.label ?? 'All',
    ...groups
      .filter((group) => groupValue(group) !== group.options[0]?.key)
      .map(
        (group) =>
          `${group.label}: ${group.options.find((option) => option.key === groupValue(group))?.label ?? groupValue(group)}`,
      ),
  ].join(', ')}, ${resultCount}`;
  const sortShort = activeSort ? (sortLabelOf(activeSort.key) ?? 'Default') : 'Default';
  const sortText = `Sort: ${sortShort}`;

  const views = COLLECTION_VIEWS;
  const nextView = views[(views.indexOf(view) + 1) % views.length];
  const viewSwitch = (
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
      {filterItems.length > 0 && (
        <Menu
          label={`${showText}. Change what is shown`}
          trigger={<span>{showText}</span>}
          triggerClassName={MENU_TRIGGER}
          items={filterItems}
        />
      )}
      {sortColumns.length > 0 && (
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
                  separatorBefore: each.separatorBefore || (index === 0 && sortItems.length > 0),
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
  // The older Change status button, for a list with transitions and no status field.
  const statusColumn = transitions !== undefined && !status && !pushedAside && !phone;
  const actionsColumn = !phone && (offersDetails || itemActions.length > 0);

  // On a fit page (`data-fit-page`, ui standard §7) the table box is the one scroll region: it keeps
  // its natural height while the rows fit and scrolls inside itself once they do not, with the
  // header row pinned. Elsewhere it scrolls sideways only, as before.
  const detailsView = (
    <div data-cv-view="details" className="relative min-w-0 cv-fill:flex cv-fill:min-h-0 cv-fill:flex-col">
      <ScrollHintOverlay hints={pushedAside ? { ...tableHints, left: false, right: false } : tableHints} />
      <div
        ref={setTableScroller}
        className={cn(
          'relative rounded-panel border border-line bg-surface shadow-raise',
          pushedAside ? 'overflow-x-hidden' : 'overflow-x-auto',
          'scroll-pt-10 cv-fill:min-h-0 cv-fill:overflow-y-auto',
          FOCUS,
        )}
      >
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-sunken text-left">
              {selectable && (
                <th scope="col" className="w-11 p-0">
                  <span className="sr-only">Selection</span>
                </th>
              )}
              <th
                scope="col"
                className="px-3 py-2 text-label uppercase text-ink-muted"
                aria-sort={titleSort !== undefined ? ariaSort(titleSort) : undefined}
              >
                {titleSort !== undefined ? sortButton(titleSort, titleLabel) : titleLabel}
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
                  {field.sortable ? sortButton(field.key, field.label, field.align === 'end') : field.label}
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
                    {/* A record code (TL-0002, RC-2026-0004) stays on one line in a table column instead of
                        breaking at its hyphen (W15 panel walk); a card keeps wrapping. */}
                    {titleOf(item, 'whitespace-nowrap')}
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
                      {renderField(field, item)}
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

  // The header button of a sortable column: the cycle of chapter 06 §11.2 with its direction icon.
  function sortButton(key: string, text: string, alignEnd = false) {
    return (
      <button
        type="button"
        onClick={() => changeQuery({ sort: nextSort(query.sort, key, defaultSort) })}
        className={cn(
          'inline-flex min-h-8 items-center gap-1 rounded-sm uppercase hover:text-ink',
          FOCUS,
          activeSort?.key === key && 'text-ink',
          alignEnd && 'flex-row-reverse',
        )}
      >
        {text}
        {activeSort?.key === key ? (
          activeSort.direction === 'asc' ? (
            <ArrowUp aria-hidden="true" data-sort-icon="asc" className="h-4 w-4" />
          ) : (
            <ArrowDown aria-hidden="true" data-sort-icon="desc" className="h-4 w-4" />
          )
        ) : (
          <ChevronsUpDown aria-hidden="true" data-sort-icon="none" className="h-4 w-4" />
        )}
      </button>
    );
  }

  function ariaSort(key: string): 'ascending' | 'descending' | undefined {
    return ariaSortOf(activeSort, key);
  }

  const compactFields = fields.filter((field) => field.compact);
  const cardFields = compactFields.length > 0 ? compactFields : fields;
  // The badge menu stays on the row in every view, phones included (§11.3): a view that does not
  // list the status field shows it after the fields.
  const statusOutside = (shown: CollectionField<T>[]) =>
    status !== undefined && !shown.some((field) => field.key === status.field);

  // The image tile of a card: the item's image, else the collection's icon, in a box of the view's size.
  const tile = (item: T, layout: (typeof CARD_LAYOUT)[CardViewKey]) => {
    const image = cardImage?.(item);
    if (image)
      return <div className={cn('shrink-0 overflow-hidden rounded-card', layout.tile)}>{image}</div>;
    if (!icon) return null;
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-card border border-line bg-sunken text-ink-muted',
          layout.tile,
          layout.icon,
        )}
      >
        {icon}
      </span>
    );
  };

  // The card views (chapter 06 §9.2; W30, Claude Design canvas "Contract Home", artboard "Large cards
  // view (1280)" and the smaller sizes): the checkbox, the image tile, the item name as the heading with
  // its subtitle, the label and value block with the status badge as the state menu (§11.3), a divider,
  // then the item actions right-aligned in their fixed slots (§11.4). Small cards and the Grid keep the
  // tile, the name, the status badge and the actions; Grid stacks the tile above the name.
  const cardsOf = (key: CardViewKey) => {
    const layout = CARD_LAYOUT[key];
    const stacked = key === 'grid';
    return (
      <div data-cv-view={key} className="[container-type:inline-size]">
        <ul aria-label={label} className={cn('grid gap-3', layout.columns)}>
          {visible.map((item, index) => {
            const id = itemId(item);
            const actions = phone ? (
              phoneMenu(item)
            ) : offersDetails || listActions.length > 0 || (transitions !== undefined && !status) ? (
              <>
                {statusMenu(item)}
                {actionButtons(item)}
              </>
            ) : null;
            const shown = layout.fields ? cardFields : [];
            return (
              <li
                key={id}
                data-cv-item={id}
                data-cv-index={index}
                onFocusCapture={noteFocus}
                className={cn(
                  'flex min-w-0 flex-col rounded-panel border border-line bg-surface shadow-raise',
                  layout.card,
                  selection.selected.has(id) && 'border-accent bg-chrome/40',
                )}
              >
                <div className={cn('flex gap-2', stacked ? 'flex-col items-center text-center' : 'items-start')}>
                  {selectable && (
                    <span className={cn('-ml-2 -mt-2 shrink-0', stacked && 'self-start')}>{checkbox(item)}</span>
                  )}
                  {tile(item, layout)}
                  <div className="min-w-0 flex-1">
                    <h3 className={cn('font-semibold [overflow-wrap:anywhere]', layout.heading)}>{titleOf(item)}</h3>
                    {layout.subtitle && cardSubtitle && (
                      <div className="mt-0.5 text-body-sm text-ink-muted [overflow-wrap:anywhere]">
                        {cardSubtitle(item)}
                      </div>
                    )}
                  </div>
                </div>
                {shown.length > 0 && (
                  <dl className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body-sm">
                    {shown.map((field) => (
                      <React.Fragment key={field.key}>
                        <dt className="text-ink-muted">{field.label}</dt>
                        <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{renderField(field, item)}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
                {statusOutside(shown) && (
                  <div className={cn(stacked && 'flex justify-center')}>{statusCell(item)}</div>
                )}
                {actions && (
                  <div className="mt-auto">
                    <div
                      className={cn(
                        'flex flex-wrap items-center gap-1 border-t border-line pt-2',
                        stacked ? 'justify-center' : 'justify-end',
                      )}
                    >
                      {actions}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

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
              title={noMatch?.title ?? NO_MATCHES}
              description={noMatch?.description}
              action={
                <Button onClick={clearFilters}>
                  Clear search and filter
                </Button>
              }
            />
          ) : (
            <EmptyState {...emptyState} />
          )}
        </div>
      );
    return view === 'details' ? detailsView : cardsOf(view);
  })();

  // A hosted pane that is pushed aside renders in the host's slot, beside every list of the host.
  const renderPane = (pane: React.ReactElement) =>
    host?.slot && placement === 'aside' ? createPortal(pane, host.slot) : pane;

  return (
    <section
      aria-label={label}
      data-cv={baseId}
      onKeyDown={onRegionKeyDown}
      className={cn(
        // min-w-0: a wide table scrolls inside its own box and never widens the list's column (W30).
        'flex min-w-0 flex-col gap-2 cv-fill-root:min-h-0',
        fitsNarrow && '[container-type:inline-size]',
        className,
      )}
    >
      {/* The one command bar row sits above the items and is never sticky (chapter 06 §9.3, §11.1). On a
          fit page it stays outside the item box, which is the scroll region, so it neither scrolls away
          nor covers a row; inside a scrolling body it moves with its own list. A sticky bar with the
          page-header offset floated over the rows of a list in a PageScrollBody (leader, 2026-11-06). */}
      {!barHidden && (
        <div
          data-cv-bar=""
          className="relative z-raised shrink-0 rounded-panel border border-line bg-surface shadow-raise"
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
      <div
        className={cn(
          'flex min-w-0 items-start gap-3 cv-fill:min-h-0 cv-fill:items-stretch',
        )}
      >
        <div className="min-w-0 flex-1 cv-fill:flex cv-fill:min-h-0 cv-fill:flex-col">
          {view === 'details' && visible.length > 0 && !error && !loading && items !== undefined ? (
            body
          ) : (
            <div
              ref={setItemBox}
              className={cn('rounded-panel cv-fill:min-h-0 cv-fill:overflow-y-auto', FOCUS)}
            >
              {body}
            </div>
          )}
          {footer && <div className="mt-2 shrink-0">{footer}</div>}
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
            statusText={status?.value(paneItem).label}
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
