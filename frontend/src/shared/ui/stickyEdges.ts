import type React from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

// Sticky edges of a scroll container: the page header, the page action bar and the CollectionView
// command bar publish their heights and keep keyboard focus clear of themselves (chapter 06 §9.7,
// §10.1 rule 3, WCAG 2.4.11).

/** The nearest scrolling ancestor; null means the document scrolls. */
export const scrollParentOf = (node: HTMLElement): HTMLElement | null => {
  for (let element = node.parentElement; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  return null;
};

/**
 * Publishes the element's height as a CSS variable on its scroll container. The shell turns the two
 * variables into scroll-padding, so keyboard focus never lands under the header or the action bar,
 * and sticky side panels offset their `top` by the header height.
 */
export const usePublishedHeight = (
  ref: React.RefObject<HTMLElement>,
  name: string,
  onResize?: (height: number) => void,
) => {
  const resized = useRef(onResize);
  useLayoutEffect(() => {
    resized.current = onResize;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const host = scrollParentOf(node) ?? document.documentElement;
    const observer = new ResizeObserver(() => {
      host.style.setProperty(name, `${node.offsetHeight}px`);
      resized.current?.(node.offsetHeight);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      host.style.removeProperty(name);
    };
  }, [ref, name]);
};

/**
 * Keeps keyboard focus clear of a sticky edge. The scroll-padding the shell sets covers anchors and
 * most browsers, but Chrome does not scroll on focus when the control is inside the scroll box and
 * only covered by the sticky element; this moves it out, with `scrollIntoView`, which honours the
 * scroll-padding. It runs on focus only, never on scroll. Focus inside a modal dialog that does not
 * hold the sticky element is left alone: the dialog is fixed above the page, so its controls are
 * never covered, and on a phone they overlap the edge's rect without being under it.
 */
export const useFocusClearOf = (ref: React.RefObject<HTMLElement>, edge: 'top' | 'bottom') => {
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const host = scrollParentOf(node) ?? document;
    const onFocus = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || node.contains(target)) return;
      const modal = target.closest('[aria-modal="true"]');
      if (modal && !modal.contains(node)) return;
      const cover = node.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const covered = edge === 'bottom' ? box.bottom > cover.top : box.top < cover.bottom;
      if (covered && typeof target.scrollIntoView === 'function')
        target.scrollIntoView({ block: 'nearest' });
    };
    host.addEventListener('focusin', onFocus);
    return () => host.removeEventListener('focusin', onFocus);
  }, [ref, edge]);
};
