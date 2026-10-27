import React, { useRef } from 'react';
import { cn } from './cn';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** A count shown after the label. */
  count?: number;
  disabled?: boolean;
}

interface TabsProps<K extends string> {
  label: string;
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Id prefix linking each tab to its panel: `${idPrefix}-panel-${key}`. */
  idPrefix: string;
  className?: string;
}

/**
 * View tabs with the WAI-ARIA tabs pattern: one tab stop, Left and Right (or Up and Down) move
 * between tabs, Home and End jump, and the selected tab activates on focus (convention 06 §5.5).
 * Render the panel with `<TabPanel>` and the same `idPrefix`.
 */
export function Tabs<K extends string>({ label, items, value, onChange, idPrefix, className }: TabsProps<K>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((item) => !item.disabled);

  const move = (event: React.KeyboardEvent, current: K) => {
    const index = enabled.findIndex((item) => item.key === current);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = enabled[next];
    onChange(target.key);
    refs.current[target.key]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]', className)}
    >
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(node) => {
              refs.current[item.key] = node;
            }}
            id={`${idPrefix}-tab-${item.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => move(event, item.key)}
            className={cn(
              '-mb-px flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-body font-semibold transition duration-tl ease-tl focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:opacity-55',
              selected ? 'border-brand text-ink dark:border-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-caption font-bold',
                  selected ? 'bg-chrome text-brand' : 'bg-sunken text-ink-muted',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The panel of the selected tab. */
export const TabPanel: React.FC<{ idPrefix: string; tabKey: string; children: React.ReactNode; className?: string }> = ({
  idPrefix,
  tabKey,
  children,
  className,
}) => (
  <div
    role="tabpanel"
    id={`${idPrefix}-panel-${tabKey}`}
    aria-labelledby={`${idPrefix}-tab-${tabKey}`}
    tabIndex={0}
    className={cn('outline-none', className)}
  >
    {children}
  </div>
);
