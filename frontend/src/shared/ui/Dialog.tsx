import React from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';
import { useFocusTrap } from './useFocusTrap';

interface Props {
  titleId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  description?: string;
  /** Buttons row; primary action last, on the right (Pattern C). */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Shows a close button in the corner. Escape closes either way. */
  showClose?: boolean;
}

const WIDTH = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl' } as const;

/**
 * A modal that traps focus, closes on Escape through `onClose` and returns focus to the control that
 * opened it. Full screen on a narrow viewport. The title and the footer stay in place and only the
 * body scrolls (leader rule of 2026-10-30), so a long form keeps its buttons in view: put them in
 * `footer`, with `form="<form id>"` on the submit button. It sits under the incident banner (z-banner), never
 * over it (convention 06 §8.9).
 */
export const Dialog: React.FC<Props> = ({
  titleId,
  title,
  onClose,
  children,
  description,
  footer,
  size = 'md',
  showClose = false,
}) => {
  const { box, onKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--tl-banner-h,0px)] z-dialog flex items-center justify-center bg-scrim/[var(--tl-scrim-alpha)] sm:p-4">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? `${titleId}-desc` : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          'relative flex h-full w-full flex-col overflow-hidden border-line bg-surface text-ink shadow-overlay sm:h-auto sm:max-h-[calc(100vh-6rem)] sm:rounded-sheet sm:border',
          WIDTH[size],
        )}
      >
        <div className="shrink-0 px-6 pt-6">
          <h2 id={titleId} className="mb-1 pr-10 text-title text-ink">
            {title}
          </h2>
          {description && (
            <p id={`${titleId}-desc`} className="mb-4 text-body text-ink-muted">
              {description}
            </p>
          )}
          {!description && <div className="mb-3" />}
        </div>
        {showClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-control text-ink hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pt-1', footer ? 'pb-1' : 'pb-6')}>{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-col-reverse gap-2 px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 sm:flex-row sm:justify-end sm:pb-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface ConfirmProps {
  titleId: string;
  /** Names the object: "Retire device TL-0042?" (convention 06 §8.1). */
  title: string;
  /** What happens, and whether it can be undone. */
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  pending?: boolean;
  /** An error from the server, kept in the dialog so the user can retry. */
  error?: string;
}

/** Asks before a destructive or state-changing action. Cancel gets focus first on destructive ones. */
export const ConfirmDialog: React.FC<ConfirmProps> = ({
  titleId,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destructive = false,
  pending = false,
  error,
}) => (
  <Dialog
    titleId={titleId}
    title={title}
    description={description}
    onClose={onCancel}
    size="sm"
    footer={
      <>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </>
    }
  >
    {error && (
      <p role="alert" className="rounded-control border border-status-critical-line bg-status-critical-tint px-3 py-2 text-body-sm text-status-critical-fg">
        {error}
      </p>
    )}
  </Dialog>
);
