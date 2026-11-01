import React from 'react';
import { cn } from '../../shared/ui/cn';
import { useConnection, type ConnectionState } from './useConnection';

const VIEW: Record<ConnectionState, { label: string; box: string; dot: string }> = {
  connected: {
    label: 'Live',
    box: 'border-status-active-line bg-status-active-tint text-status-active-fg',
    dot: 'bg-status-active-fg shadow-[0_0_0_3px_rgb(var(--tl-status-active-fg)/0.25)]',
  },
  polling: {
    label: 'Auto refresh',
    box: 'border-status-active-line bg-status-active-tint text-status-active-fg',
    dot: 'bg-status-active-fg',
  },
  reconnecting: {
    label: 'Reconnecting',
    box: 'border-status-attention-line bg-status-attention-tint text-status-attention-fg',
    dot: 'bg-status-attention-fg motion-safe:animate-pulse',
  },
  offline: {
    label: 'Offline',
    box: 'border-line-strong bg-transparent text-ink-muted',
    dot: 'border-2 border-dashed border-ink-muted bg-transparent',
  },
};

/**
 * The live connection state in the header (Pattern B connectivity indicator). The text is always
 * there for screen readers; on a phone only the dot shows, and its shape differs per state.
 */
export const ConnectionIndicator: React.FC<{ className?: string }> = ({ className }) => {
  const state = useConnection();
  const view = VIEW[state];
  return (
    <span
      aria-live="polite"
      title={`Live updates: ${view.label}`}
      className={cn('inline-flex h-8 shrink-0 items-center gap-2 rounded-control border px-2 text-body-sm font-bold sm:px-2.5', view.box, className)}
    >
      <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full', view.dot)} />
      <span className="sr-only sm:not-sr-only">{view.label}</span>
      <span className="sr-only"> live updates</span>
    </span>
  );
};
