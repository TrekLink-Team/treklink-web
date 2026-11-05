import React from 'react';
import { cn } from '../../shared/ui/cn';

/** The theme-coloured TrekLink mark, followed by the wordmark where space allows. */
export const BrandMark: React.FC<{ showWordmark?: boolean; className?: string }> = ({ showWordmark = true, className }) => (
  <span className={cn('flex items-center gap-2', className)}>
    <span
      role="img"
      aria-label="TrekLink"
      className="h-[18px] w-[47px] shrink-0 bg-brand"
      style={{
        maskImage: "url('/brand/treklink-mark.webp')",
        WebkitMaskImage: "url('/brand/treklink-mark.webp')",
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
    {showWordmark ? (
      <span aria-hidden="true" className="font-display text-[1.0625rem] font-extrabold tracking-tight text-ink">TrekLink</span>
    ) : null}
  </span>
);
