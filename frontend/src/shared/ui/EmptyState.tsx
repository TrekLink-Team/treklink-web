import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: string;
  /** What to do next (convention 06 §8.4): never a blank table. */
  description?: string;
  /** The one next step, usually a Button or a link styled with buttonClasses. */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

/** The empty or no-results state of a list, a panel or a search. */
export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, action, icon, className }) => (
  <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
    <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-panel bg-chrome text-brand [&>svg]:h-6 [&>svg]:w-6">
      {icon ?? <Inbox />}
    </span>
    <p className="font-display text-title-sm text-ink">{title}</p>
    {description && <p className="max-w-measure text-body text-ink-muted">{description}</p>}
    {action && <div className="mt-1">{action}</div>}
  </div>
);
