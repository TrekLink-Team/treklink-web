import type React from 'react';

// The inputs of CollectionView (chapter 06 §9.1, D-096). The module is a library component: it knows
// nothing about a module, an endpoint or the server's result set. A page supplies the data, the
// fields and the actions.

export type CollectionViewKey = 'details' | 'list' | 'cards';

export interface CollectionNoun {
  one: string;
  other: string;
}

export interface CollectionField<T> {
  key: string;
  label: string;
  render: (item: T) => React.ReactNode;
  /** Plain text of the value: the client-side search and sort read it. */
  text?: (item: T) => string;
  /** A value to sort on; defaults to `text`. */
  sortValue?: (item: T) => string | number | null;
  sortable?: boolean;
  /** Leaves the table while the details pane is pushed aside, because the pane shows it (§10.8). */
  hideWithPane?: boolean;
  /** Shown in the List and card views too, after the item's title. */
  compact?: boolean;
  align?: 'start' | 'end';
}

/** A plain per-item action: an icon button with the §9.5 tooltip. */
export interface CollectionAction<T> {
  key: string;
  /** The verb: the tooltip text and the start of the accessible name ("Edit", then "Edit TL-0042"). */
  label: string;
  icon: React.ReactNode;
  onSelect: (item: T) => void;
  /**
   * The accessible name when "label itemName" does not read well ("Change role of Pham Van D"). It
   * must start with `label`, so the name contains the visible tooltip (2.5.3).
   */
  accessibleName?: (item: T) => string;
  /** False hides the action for this item (a permission or a state the action does not apply to). */
  allowed?: (item: T) => boolean;
  /** Shown but unavailable, with this reason as text. */
  unavailableReason?: (item: T) => string | undefined;
  destructive?: boolean;
}

/**
 * One state transition allowed from the item's current state for this user, from the module spec's
 * state machine (D-030) and already filtered by the caller's abilities (§9.6). Choosing it calls
 * `onSelect`, which opens the confirmation dialog of §8.1 on the page.
 */
export interface CollectionTransition<T> {
  key: string;
  /** A verb: "Retire device". */
  label: string;
  destructive?: boolean;
  onSelect: (items: T[]) => void;
}

/** A command of the command bar with no selection (Register device, Export). */
export interface CollectionCommand {
  key: string;
  /** The accessible name and the tooltip. */
  label: string;
  icon: React.ReactNode;
  /** A short visible label, contained in `label` (2.5.3). Without it the command is an icon button. */
  shortLabel?: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** An action on the selection, named verb plus count plus noun ("Check in 3 units", §9.4). */
export interface CollectionBulkAction<T> {
  key: string;
  label: (count: number) => string;
  icon?: React.ReactNode;
  /** Only the selected items this action applies to are counted and passed. */
  appliesTo?: (item: T) => boolean;
  destructive?: boolean;
  onSelect: (items: T[]) => void;
}

export interface CollectionFilter<T> {
  key: string;
  label: string;
  /** Client-side test. A server-paged collection leaves it out and filters on the server. */
  test?: (item: T) => boolean;
}

export type CollectionSortDirection = 'asc' | 'desc';

export interface CollectionSort {
  key: string;
  direction: CollectionSortDirection;
}

/** Search, filter and sort: a change to any of them clears the selection (§9.4 rule 4). */
export interface CollectionQuery {
  search: string;
  filter: string;
  sort: CollectionSort | null;
}

export interface CollectionDetails<T> {
  /** Field keys the pane lists; every field by default. */
  fields?: string[];
  /** The record's image slot, where it has one (a variant photo). */
  image?: (item: T) => React.ReactNode;
  /** Extra content under the fields. */
  extra?: (item: T) => React.ReactNode;
  /** The link to the full page. */
  href?: (item: T) => string | undefined;
  hrefLabel?: string;
}

export interface CollectionEmptyState {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** The server's page, for the "57 devices, showing 1 to 20" announcement. */
export interface CollectionPageInfo {
  total: number;
  from: number;
  to: number;
}
