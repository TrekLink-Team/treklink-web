import React from 'react';
import { cn } from './cn';

/** A loading placeholder in the shape of the content. Wrap a group in role="status" with a label. */
export const Skeleton: React.FC<{ className?: string; rounded?: 'control' | 'full' | 'panel' }> = ({
  className,
  rounded = 'control',
}) => (
  <div
    aria-hidden="true"
    className={cn('tl-skeleton', rounded === 'full' ? 'rounded-full' : rounded === 'panel' ? 'rounded-panel' : 'rounded-control', className)}
  />
);

/** Lines of text placeholder. */
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({ lines = 3, className }) => (
  <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
    {Array.from({ length: lines }, (_, index) => (
      <Skeleton key={index} className={cn('h-3.5', index === lines - 1 ? 'w-3/5' : 'w-full')} />
    ))}
  </div>
);
