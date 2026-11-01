import type React from 'react';
import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Focus handling shared by Dialog and Drawer: focus moves inside on open, Tab cycles within, Escape
 * calls `onClose` (which may ask first, chapter 06 §8.7), and focus returns to the opener on close.
 * `initialFocus` names the control to start on, such as the least destructive button of an
 * alert dialog; otherwise the first focusable control gets focus.
 */
export const useFocusTrap = (onClose: () => void, initialFocus?: React.RefObject<HTMLElement | null>) => {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? box.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => opener?.focus();
    // The start control is read once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { box, onKeyDown };
};

