// The selection rules of chapter 06 §9.4 as pure functions over item ids, so they are tested without
// a renderer. The module only knows the items of the page it was given: select-all covers that page
// and nothing beyond it (leader, 2026-11-03).

export interface SelectionState {
  selected: ReadonlySet<string>;
  /** The item a Shift range starts from: the last item toggled on its own. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

/**
 * Click or Space toggles one item and sets the anchor. With `range`, every item from the anchor to
 * this one is selected, in the order of `ids`, and the anchor stays where it was.
 */
export const toggleItem = (
  state: SelectionState,
  id: string,
  ids: readonly string[],
  range: boolean,
): SelectionState => {
  const anchorIndex = state.anchor === null ? -1 : ids.indexOf(state.anchor);
  const index = ids.indexOf(id);
  if (range && anchorIndex >= 0 && index >= 0) {
    const [from, to] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
    const selected = new Set(state.selected);
    ids.slice(from, to + 1).forEach((each) => selected.add(each));
    return { selected, anchor: state.anchor };
  }
  const selected = new Set(state.selected);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return { selected, anchor: id };
};

export type PageSelection = 'none' | 'some' | 'all';

/** The select-all checkbox state over the current page: checked, unchecked or mixed. */
export const pageSelection = (selected: ReadonlySet<string>, ids: readonly string[]): PageSelection => {
  const count = ids.filter((id) => selected.has(id)).length;
  if (count === 0) return 'none';
  return count === ids.length ? 'all' : 'some';
};

/** Select-all: selects every item of the page, or clears the page when all of it is selected. */
export const toggleAll = (state: SelectionState, ids: readonly string[]): SelectionState =>
  pageSelection(state.selected, ids) === 'all'
    ? { selected: new Set(), anchor: null }
    : { selected: new Set(ids), anchor: state.anchor };

/** Drops ids the page no longer holds, so a bulk action never acts on items out of sight. */
export const keepVisible = (state: SelectionState, ids: readonly string[]): SelectionState => {
  const visible = new Set(ids);
  const kept = [...state.selected].filter((id) => visible.has(id));
  if (kept.length === state.selected.size) return state;
  return {
    selected: new Set(kept),
    anchor: state.anchor !== null && visible.has(state.anchor) ? state.anchor : null,
  };
};
