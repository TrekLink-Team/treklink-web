import { useCallback, useEffect } from 'react';
import { useShell, type InfoPaneContent } from './shellStore';

/** The width from which the Info pane docks beside the body. */
export const DOCKED_QUERY = '(min-width: 1280px)';

/**
 * Puts the details of the selected record in the shell's Info pane, the right panel (DS-13). Call it
 * from a page with the current selection, or with a page summary when nothing is selected; pass
 * null to remove the pane. The pane clears itself when the page unmounts. Map pages do not call it.
 *
 * Keep `content` stable with useMemo, keyed on the selection, so the pane does not re-render on
 * every keystroke of the page.
 */
export const useInfoPane = (content: InfoPaneContent | null): void => {
  const setInfo = useShell((state) => state.setInfo);
  useEffect(() => {
    setInfo(content);
  }, [content, setInfo]);
  useEffect(
    () => () => {
      setInfo(null);
      useShell.getState().setInfoSheet(false);
    },
    [setInfo],
  );
};

/**
 * Shows the details, for a row click: opens the docked pane from 1280 px and the sheet below that.
 */
export const useOpenInfoPane = (): (() => void) => {
  const setInfoOpen = useShell((state) => state.setInfoOpen);
  const setInfoSheet = useShell((state) => state.setInfoSheet);
  return useCallback(() => {
    const docked = typeof window.matchMedia === 'function' && window.matchMedia(DOCKED_QUERY).matches;
    if (docked) setInfoOpen(true);
    else setInfoSheet(true);
  }, [setInfoOpen, setInfoSheet]);
};
