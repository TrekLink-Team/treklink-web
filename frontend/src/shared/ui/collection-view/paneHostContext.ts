import { createContext, useContext } from 'react';

/**
 * The shared details pane of a page with several related lists (chapter 06 §10.8 `paneHost`, D-096):
 * Money has Invoices and Payments. One list at a time owns the pane; while any pane is pushed aside,
 * every list in the host fits the narrower width.
 */
export interface PaneHostValue {
  /** The list whose pane is open, or null. */
  owner: string | null;
  /** Where a list portals its pane while it is pushed aside. */
  slot: HTMLElement | null;
  claim: (owner: string) => void;
  release: (owner: string) => void;
}

export const PaneHostContext = createContext<PaneHostValue | null>(null);

export const usePaneHost = () => useContext(PaneHostContext);
