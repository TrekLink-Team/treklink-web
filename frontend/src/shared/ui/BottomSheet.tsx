import React, { useId } from 'react';
import { cn } from './cn';

/** The three snap positions of a phone sheet (screen 9.1): a strip with a summary, half the screen, most of it. */
export type SheetState = 'peek' | 'half' | 'full';

const NEXT: Record<SheetState, SheetState> = { peek: 'half', half: 'full', full: 'peek' };
// The peek is a fixed strip, so a page reserves it under its content (`pb-[4.5rem]`) and the content
// never resizes when the sheet opens: half and full cover it instead.
const HEIGHT: Record<SheetState, string> = {
  peek: 'h-[4.5rem]',
  half: 'h-1/2',
  full: 'h-[85%]',
};
const HINT: Record<SheetState, string> = {
  peek: 'open the panel',
  half: 'open the panel further',
  full: 'close the panel',
};

interface BottomSheetProps {
  /** The accessible name of the panel. */
  label: string;
  /** The line the handle shows in every position, such as a device count. */
  summary: React.ReactNode;
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * A panel docked to the bottom of its positioned parent on a phone, with three snap positions. The
 * handle is a button: Enter or Space moves to the next position, Escape closes to the peek, so the
 * sheet works without dragging (WCAG 2.5.7). The body is not rendered in the peek.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  label,
  summary,
  state,
  onStateChange,
  children,
  className,
}) => {
  const bodyId = useId();
  return (
    <aside
      aria-label={label}
      data-sheet={state}
      className={cn(
        'absolute inset-x-0 bottom-0 z-[900] flex flex-col overflow-hidden rounded-t-sheet border border-line bg-surface shadow-sheet',
        HEIGHT[state],
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={state !== 'peek'}
        aria-controls={state !== 'peek' ? bodyId : undefined}
        onClick={() => onStateChange(NEXT[state])}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || state === 'peek') return;
          event.stopPropagation();
          onStateChange('peek');
        }}
        className="flex min-h-[4.5rem] w-full shrink-0 flex-col items-center justify-center gap-2 px-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line-strong" />
        <span className="w-full text-body-sm font-semibold text-ink">
          {summary}
          <span className="sr-only">, {HINT[state]}</span>
        </span>
      </button>
      {state !== 'peek' && (
        <div id={bodyId} className="min-h-0 flex-1 overflow-y-auto border-t border-line">
          {children}
        </div>
      )}
    </aside>
  );
};
