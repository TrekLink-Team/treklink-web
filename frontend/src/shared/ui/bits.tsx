import React from 'react';
import { messageOf } from './errors';
import { ALERT, SECONDARY_BUTTON } from './styles';

// Small building blocks of the contract and billing pages: a status label, the pager, and the
// loading, empty and error states every page task lists (specs/frontend/tasks.md).

export const Badge: React.FC<{ tone: string; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}
  >
    {children}
  </span>
);

export const PageTitle: React.FC<{ title: string; action?: React.ReactNode; id?: string }> = ({
  title,
  action,
  id,
}) => (
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
    <h1 id={id} tabIndex={-1} className="text-2xl font-bold text-slate-900">
      {title}
    </h1>
    {action}
  </div>
);

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div role="status" aria-live="polite" className="flex flex-col gap-2 py-4">
    <span className="sr-only">{label}</span>
    {[0, 1, 2].map((row) => (
      <div key={row} className="h-10 animate-pulse rounded-lg bg-slate-200" />
    ))}
  </div>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-700">
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
      <button type="button" onClick={onRetry} className="font-semibold underline">
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
    <nav aria-label="Pages" className="mt-4 flex items-center justify-end gap-3 text-sm">
      <button
        type="button"
        className={SECONDARY_BUTTON}
        disabled={pageNumber <= 1}
        onClick={() => onPage(pageNumber - 1)}
      >
        Previous
      </button>
      <span>
        Page {pageNumber} of {totalPages}
      </span>
      <button
        type="button"
        className={SECONDARY_BUTTON}
        disabled={pageNumber >= totalPages}
        onClick={() => onPage(pageNumber + 1)}
      >
        Next
      </button>
    </nav>
  ) : null;

export const Field: React.FC<{
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ id, label, error, hint, children }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-semibold text-slate-900">
      {label}
    </label>
    {children}
    {hint && !error && <p className="text-sm text-slate-600">{hint}</p>}
    {error && (
      <p id={`${id}-error`} role="alert" className="text-sm text-red-700">
        {error}
      </p>
    )}
  </div>
);

// A definition row of a detail page.
export const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 text-slate-900">{children}</dd>
  </div>
);
