import React, { useRef } from 'react';
import { cn } from './cn';
import { ScrollHintOverlay } from './ScrollHints';
import { useScrollHints } from './useScrollHints';

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  children: React.ReactNode;
  /** Wraps instead of scrolling from this width up, as a Tailwind breakpoint ("sm"); never by default. */
  wrapFrom?: 'sm' | 'md';
  /**
   * A strip with no focusable item (a stepper) takes this name and a tab stop while it overflows, so
   * keyboard users can scroll it (chapter 06 §10.6 rule 3).
   */
  scrollLabel?: string;
  innerClassName?: string;
}

const WRAP = { sm: 'sm:flex-wrap sm:overflow-visible', md: 'md:flex-wrap md:overflow-visible' } as const;

/**
 * A row that scrolls sideways when it does not fit (a chip row, a step row), with the fading edges and
 * arrow buttons of chapter 06 §10.6. The wrapper is `position: relative` (rule 4). Props other than
 * the ones above go to the scrolling row, so it can carry its own role and name.
 */
export const ScrollStrip: React.FC<Props> = ({
  children,
  wrapFrom,
  scrollLabel,
  className,
  innerClassName,
  ...rest
}) => {
  const row = useRef<HTMLDivElement>(null);
  const hints = useScrollHints(row);
  const named = scrollLabel !== undefined && hints.overflows;
  return (
    <div className={cn('relative min-w-0', className)}>
      <ScrollHintOverlay hints={hints} surface="ground" />
      <div
        ref={row}
        {...rest}
        tabIndex={named ? 0 : rest.tabIndex}
        aria-label={named && !rest['aria-label'] ? scrollLabel : rest['aria-label']}
        className={cn(
          'relative flex flex-nowrap gap-2 overflow-x-auto [scrollbar-width:none]',
          wrapFrom && WRAP[wrapFrom],
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
};
