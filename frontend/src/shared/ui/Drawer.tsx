import React from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';
import { useFocusTrap } from './useFocusTrap';

interface DrawerProps {
  titleId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** `left` for navigation, `right` for details, `bottom` for a phone sheet. */
  side?: 'left' | 'right' | 'bottom';
  /** Visually hides the title (navigation drawers show the product mark instead). */
  hideTitle?: boolean;
  footer?: React.ReactNode;
  className?: string;
}

const PLACE = {
  left: 'inset-y-0 left-0 w-[min(20rem,88vw)] rounded-r-sheet',
  right: 'inset-y-0 right-0 w-[min(24rem,92vw)] rounded-l-sheet',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-sheet',
} as const;

/**
 * A modal panel from an edge: the navigation drawer below 1024 px, the Info sheet on tablet and the
 * bottom sheet on phone. Escape and the scrim close it; focus is trapped and returns to the opener.
 */
export const Drawer: React.FC<DrawerProps> = ({
  titleId,
  title,
  onClose,
  children,
  side = 'right',
  hideTitle,
  footer,
  className,
}) => {
  const { box, onKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--tl-banner-h,0px)] z-drawer">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-scrim/[var(--tl-scrim-alpha)]" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className={cn('tl-glass-strong absolute flex flex-col text-ink shadow-overlay', PLACE[side], className)}
      >
        {side === 'bottom' && <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />}
        <div className="flex min-h-14 items-center gap-2 px-4 pt-1">
          <h2 id={titleId} className={cn('flex-1 truncate text-title-sm', hideTitle && 'sr-only')}>
            {title}
          </h2>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-control hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
};
