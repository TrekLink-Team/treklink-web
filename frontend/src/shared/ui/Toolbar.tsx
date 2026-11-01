import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from './cn';

/**
 * The function toolbar between the page header and the body (DS-13). Same height and place on every
 * page: search and filters on the left (`start`), view tools on the right (`end`). With rows
 * selected, pass `selection` and the left side becomes the selection count and bulk actions.
 */
export const Toolbar: React.FC<{
  label: string;
  start?: React.ReactNode;
  end?: React.ReactNode;
  selection?: { count: number; onClear: () => void; actions: React.ReactNode };
  className?: string;
}> = ({ label, start, end, selection, className }) => (
  <div
    role="toolbar"
    aria-label={selection && selection.count > 0 ? `${label}: selection actions` : label}
    className={cn('tl-glass mb-3 flex min-h-toolbar flex-wrap items-center gap-2 rounded-card px-2 py-2', className)}
  >
    {selection && selection.count > 0 ? (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Clear selection"
          onClick={selection.onClear}
          className="flex h-9 w-9 items-center justify-center rounded-control text-ink hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
        <span aria-live="polite" className="pr-2 font-bold text-ink">
          {selection.count} selected
        </span>
        <span aria-hidden="true" className="h-6 w-px bg-line" />
        {selection.actions}
      </div>
    ) : (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{start}</div>
    )}
    {end && <div className="ml-auto flex items-center gap-0.5">{end}</div>}
  </div>
);

/** The search field of a toolbar. The label is visually hidden; the placeholder is a hint only. */
export const ToolbarSearch: React.FC<{
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}> = ({ id, label, placeholder, value, onChange, className }) => (
  <div className={cn('relative flex h-9 w-full items-center sm:w-72', className)}>
    <label htmlFor={id} className="sr-only">
      {label}
    </label>
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-ink-muted" />
    <input
      id={id}
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-control border border-line-strong bg-surface pl-9 pr-3 text-body text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    />
  </div>
);

/**
 * An applied filter, removable. The remove button looks 28 px but its hit area reaches 44 px
 * through an inset pseudo-element (WCAG 2.5.8; TrekLink default for touch targets).
 */
export const FilterChip: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <span className="inline-flex h-9 items-center gap-1 rounded-control bg-chrome pl-2.5 pr-1 text-body-sm font-semibold text-ink">
    {label}
    <button
      type="button"
      aria-label={`Remove filter ${label}`}
      onClick={onRemove}
      className="relative flex h-7 w-7 items-center justify-center rounded-sm text-ink-muted before:absolute before:-inset-2 before:content-[''] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <X aria-hidden="true" className="h-4 w-4" />
    </button>
  </span>
);
