import React from 'react';
import { cn } from '../../shared/ui/cn';

/** The product mark: a ridge line in the accent tile, then the wordmark. */
export const BrandMark: React.FC<{ showWordmark?: boolean; className?: string }> = ({ showWordmark = true, className }) => (
  <span className={cn('flex items-center gap-2', className)}>
    <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-on-accent shadow-press">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 19 6-11 4 6 2-3 6 8Z" />
      </svg>
    </span>
    {showWordmark ? (
      <span className="font-display text-[1.0625rem] font-extrabold tracking-tight text-ink">TrekLink</span>
    ) : (
      <span className="sr-only">TrekLink</span>
    )}
  </span>
);
