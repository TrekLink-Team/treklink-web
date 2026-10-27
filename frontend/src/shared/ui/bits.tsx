import React from 'react';
import { Badge as SystemBadge } from './Badge';
import { Button } from './Button';
import { messageOf } from './errors';
import { Field as SystemField } from './Field';
import { Skeleton } from './Skeleton';
import { ALERT } from './styles';

// Small building blocks of the first contract and billing pages: a status label, the pager, and
// the loading, empty and error states every page task lists (specs/frontend/tasks.md). They keep
// their names and props so those pages build unchanged, and now render the TrekLink System
// components. New code imports the components directly (Badge, Field, Pagination, EmptyState).

/** A label whose colour comes from an entity's *_TONES map (a class string) or a status tone. */
export const Badge: React.FC<{ tone: string; children: React.ReactNode }> = ({ tone, children }) => (
  <SystemBadge tone={tone}>{children}</SystemBadge>
);

export const PageTitle: React.FC<{ title: string; action?: React.ReactNode; id?: string }> = ({
  title,
  action,
  id,
}) => (
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
    <h1 id={id} tabIndex={-1} className="text-title-lg text-ink outline-none">
      {title}
    </h1>
    {action}
  </div>
);

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div role="status" aria-live="polite" className="flex flex-col gap-2 py-4">
    <span className="sr-only">{label}</span>
    {[0, 1, 2].map((row) => (
      <Skeleton key={row} className="h-10" />
    ))}
  </div>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-panel border border-dashed border-line-strong bg-surface p-8 text-center text-body text-ink-muted">
    {children}
  </div>
);

export const ErrorState: React.FC<{ error: unknown; onRetry?: () => void }> = ({
  error,
  onRetry,
}) => (
  <div role="alert" className={`${ALERT} flex flex-wrap items-center justify-between gap-3`}>
    <span>{messageOf(error)}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="min-h-9 font-semibold underline underline-offset-4">
        Try again
      </button>
    )}
  </div>
);

export const Pager: React.FC<{
  pageNumber: number;
  totalPages: number;
  onPage: (page: number) => void;
}> = ({ pageNumber, totalPages, onPage }) =>
  totalPages > 1 ? (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-end gap-3 text-body-sm text-ink-muted">
      <Button disabled={pageNumber <= 1} onClick={() => onPage(pageNumber - 1)}>
        Previous
      </Button>
      <span className="text-ink">
        Page {pageNumber} of {totalPages}
      </span>
      <Button disabled={pageNumber >= totalPages} onClick={() => onPage(pageNumber + 1)}>
        Next
      </Button>
    </nav>
  ) : null;

export const Field: React.FC<{
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}> = (props) => <SystemField {...props} />;

// A definition row of a detail page.
export const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <dt className="text-label uppercase text-ink-muted">{label}</dt>
    <dd className="mt-0.5 text-body text-ink">{children}</dd>
  </div>
);
