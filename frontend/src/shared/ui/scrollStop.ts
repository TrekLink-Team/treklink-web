import { useEffect } from 'react';

/** Any element a keyboard user can reach with Tab. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Keeps a scroll region reachable from the keyboard (viewport rule, ui standard §7): while nothing
 * inside the region is focusable, the region takes a tab stop and a name of its own, so a keyboard
 * user can still scroll it (WCAG 2.1.1). Checked after every render of the owner, so a list that
 * gains or loses its links follows. The owner must not set `tabIndex` on the region itself.
 */
export function useScrollStop(node: HTMLElement | null, label: string): void {
  useEffect(() => {
    if (!node) return;
    const reachable = node.querySelector(FOCUSABLE) !== null;
    const set = node.getAttribute('data-scroll-stop');
    if (reachable && set !== null) {
      node.removeAttribute('tabindex');
      // Only a name this hook gave is taken back; a region named by its owner keeps its name.
      if (set === 'named') node.removeAttribute('aria-label');
      node.removeAttribute('data-scroll-stop');
    } else if (!reachable && set === null) {
      node.setAttribute('tabindex', '0');
      const named = node.hasAttribute('aria-label') || node.hasAttribute('aria-labelledby');
      if (!named) node.setAttribute('aria-label', label);
      node.setAttribute('data-scroll-stop', named ? '' : 'named');
    }
  });
}
