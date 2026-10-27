import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';

export interface Crumb {
  label: string;
  /** Absent on the current page, which is the last crumb. */
  to?: string;
}

/** The trail above a page title. On a phone only the parent shows, as a back link. */
export const Breadcrumb: React.FC<{ items: Crumb[]; className?: string }> = ({ items, className }) => {
  if (items.length === 0) return null;
  const parent = [...items].reverse().find((item) => item.to);
  return (
    <nav aria-label="Breadcrumb" className={cn('text-body-sm text-ink-muted', className)}>
      {parent?.to && (
        <Link
          to={parent.to}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-sm font-medium hover:text-ink sm:hidden"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          {parent.label}
        </Link>
      )}
      <ol className="hidden flex-wrap items-center gap-1.5 sm:flex">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.to && !last ? (
                <Link to={item.to} className="rounded-sm hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'font-semibold text-ink')}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export interface PageHeaderProps {
  title: string;
  /** Id for the heading, so a section can use aria-labelledby and focus can move to it. */
  id?: string;
  breadcrumb?: Crumb[];
  /** A short line next to the title: a count or a freshness note. */
  meta?: React.ReactNode;
  description?: string;
  /** The one primary action, top right (convention 06 §8.2). */
  primaryAction?: React.ReactNode;
  /** Secondary actions, placed before the primary one. */
  actions?: React.ReactNode;
  className?: string;
}

/** Breadcrumb, title and the primary action. One per page, first in the content area. */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  id,
  breadcrumb,
  meta,
  description,
  primaryAction,
  actions,
  className,
}) => (
  <header className={cn('mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
    <div className="flex min-w-0 flex-col gap-1">
      {breadcrumb && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 id={id} tabIndex={-1} className="text-title-lg text-ink outline-none">
          {title}
        </h1>
        {meta && <span className="text-body text-ink-muted">{meta}</span>}
      </div>
      {description && <p className="max-w-measure text-body text-ink-muted">{description}</p>}
    </div>
    {(actions || primaryAction) && (
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {primaryAction}
      </div>
    )}
  </header>
);
