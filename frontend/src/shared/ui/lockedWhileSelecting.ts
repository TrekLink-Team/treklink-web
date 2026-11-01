import type { MenuItem } from './Menu';

const BULK_REASON = 'Clear the selection to use row actions.';

/**
 * Row actions while rows are selected (UI standard §2): every action stays visible but disabled with the
 * reason. `DataTable` applies it to its own row menus; a phone card that renders the row actions itself
 * calls it with the same selection.
 */
export const lockedWhileSelecting = (actions: MenuItem[], selecting: boolean): MenuItem[] =>
  selecting ? actions.map((action) => ({ ...action, disabled: true, disabledReason: BULK_REASON })) : actions;
