import React from 'react';
import { Pagination } from './DataTable';
import { messageOf } from './errors';
import { Skeleton } from './Skeleton';
import { ALERT, FOCUS } from './styles';

// Small building blocks of the first contract and billing pages: the page title, the loading, empty
// and error states every page task lists (specs/frontend/tasks.md), and a definition row. Badge and
// Field are the shared components re-exported, and Pager is Pagination, so the imports of those
// pages keep working without a second implementation (ui standard, 2026-11-01). New code imports
// the components directly (Badge, Field, Pagination, EmptyState).

// Badge takes a status tone or a class string from an entity's *_TONES map.
export { Badge } from './Badge';
export { Field } from './Field';

export const PageTitle: React.FC<{ title: string; action?: React.ReactNode; id?: string }> = ({
  title,
  action,
  id,
}) => (
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 group-data-[compact=true]/chrome:mb-2">
    <h1 id={id} tabIndex={-1} className="text-title-lg text-ink outline-none group-data-[compact=true]/chrome:text-title-sm">
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
      <button
        type="button"
        onClick={onRetry}
        className={`inline-flex min-h-11 items-center rounded-control px-2 font-semibold underline underline-offset-4 ${FOCUS}`}
      >
        Try again
      </button>
    )}
  </div>
);

/** The pager of the first list pages: Pagination, shown only when there is more than one page. */
export const Pager: React.FC<{
  pageNumber: number;
  totalPages: number;
  onPage: (page: number) => void;
}> = ({ pageNumber, totalPages, onPage }) =>
  totalPages > 1 ? (
    <Pagination
      pageNumber={pageNumber}
      totalPages={totalPages}
      onPage={onPage}
      className="mt-4 rounded-panel border border-line bg-surface"
    />
  ) : null;

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
