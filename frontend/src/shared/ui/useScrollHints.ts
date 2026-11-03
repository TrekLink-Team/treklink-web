import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

// Measures a strip that scrolls sideways for its hints (chapter 06 §10.6): which sides have more
// content, and a scroll of about 70 % of the visible width, instant under reduced motion.

export const SCROLL_STEP = 0.7;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface ScrollHintState {
  left: boolean;
  right: boolean;
  /** True when the strip holds more than it shows. */
  overflows: boolean;
  scroll: (direction: -1 | 1) => void;
}

/** Watches a sideways scroller; re-measures on scroll, on resize and when its content changes. */
export const useScrollHints = (ref: React.RefObject<HTMLElement | null>): ScrollHintState => {
  const [edges, setEdges] = useState({ left: false, right: false, overflows: false });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const left = node.scrollLeft > 2;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 2;
    const overflows = node.scrollWidth > node.clientWidth + 2;
    setEdges((current) =>
      current.left === left && current.right === right && current.overflows === overflows
        ? current
        : { left, right, overflows },
    );
  }, [ref]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [ref, measure]);

  const scroll = useCallback(
    (direction: -1 | 1) => {
      const node = ref.current;
      if (!node || typeof node.scrollBy !== 'function') return;
      node.scrollBy({
        left: direction * Math.round(node.clientWidth * SCROLL_STEP),
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
    },
    [ref],
  );

  return { ...edges, scroll };
};
