import React from 'react';
import { cn } from './cn';
import { TONE_TEXT, type StatusTone } from './status';

export interface StatCardProps {
  label: string;
  /** The figure, already formatted (VND with thousands separators, no decimals). */
  value: React.ReactNode;
  /** Context under the figure: a period, a comparison or "updated 08:14". */
  hint?: string;
  icon?: React.ReactNode;
  /** Colours the icon and the hint when the figure needs attention. Neutral by default. */
  tone?: StatusTone;
  /** Makes the whole card a link to the list behind the figure. */
  href?: string;
  className?: string;
}

/** A dashboard KPI. The figure is real data from an endpoint; no placeholder numbers in production. */
export const StatCard: React.FC<StatCardProps> = ({ label, value, hint, icon, tone, href, className }) => {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-label uppercase text-ink-muted">{label}</p>
        {icon && (
          <span aria-hidden="true" className={cn('flex h-9 w-9 items-center justify-center rounded-control bg-chrome text-brand [&>svg]:h-5 [&>svg]:w-5', tone && TONE_TEXT[tone])}>
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-kpi tabular-nums text-ink">{value}</p>
      {hint && <p className={cn('mt-1 text-body-sm text-ink-muted', tone && TONE_TEXT[tone])}>{hint}</p>}
    </>
  );
  const box = cn('block rounded-panel border border-line bg-surface p-4 shadow-raise', className);
  return href ? (
    <a href={href} className={cn(box, 'transition hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus')}>
      {body}
    </a>
  ) : (
    <div className={box}>{body}</div>
  );
};
