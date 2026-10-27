import React from 'react';
import { cn } from './cn';

type CardProps = React.HTMLAttributes<HTMLElement> & {
  /** `solid` for data (default); `glass` only over textured backdrops such as the map. */
  surface?: 'solid' | 'glass';
  padding?: 'none' | 'sm' | 'md';
  as?: 'section' | 'div' | 'article';
};

const PADDING = { none: '', sm: 'p-4', md: 'p-5' } as const;

/** A container for one subject. Data cards are solid so their contrast never depends on the page. */
export const Card: React.FC<CardProps> = ({ surface = 'solid', padding = 'md', as: Tag = 'section', className, ...rest }) => (
  <Tag
    className={cn(
      'rounded-panel',
      surface === 'solid' ? 'border border-line bg-surface shadow-raise' : 'tl-glass',
      PADDING[padding],
      className,
    )}
    {...rest}
  />
);

/** Title row of a card, with an optional action on the right. */
export const CardHeader: React.FC<{ title: string; id?: string; action?: React.ReactNode; description?: string }> = ({
  title,
  id,
  action,
  description,
}) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h2 id={id} className="text-title-sm text-ink">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p>}
    </div>
    {action}
  </div>
);
