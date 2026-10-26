import React, { useEffect, useRef } from 'react';

interface Props {
  titleId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const FOCUSABLE = 'input, select, textarea, button:not([disabled]), a[href]';

// A modal that traps focus, closes on Escape through `onClose` (which may ask first, chapter 06
// §8.7) and returns focus to the control that opened it. Full screen on a narrow viewport.
export const Dialog: React.FC<Props> = ({ titleId, title, onClose, children }) => {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus();
  }, []);

  const keepFocusInside = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 sm:p-4">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={keepFocusInside}
        className="h-full w-full overflow-y-auto bg-white p-6 sm:h-auto sm:max-w-md sm:rounded-xl"
      >
        <h2 id={titleId} className="mb-4 text-xl font-bold text-slate-900">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
};
