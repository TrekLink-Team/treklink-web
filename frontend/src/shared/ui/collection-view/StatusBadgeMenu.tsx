import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '../Badge';
import { BADGE_BASE, badgeTone } from '../badgeTone';
import { cn } from '../cn';
import { Menu } from '../Menu';
import type { CollectionStatusValue, CollectionTransition } from './types';

// The status badge as the state-change control (chapter 06 §11.3, 0-ui-standard §8.2). The badge
// follows the Atlassian lozenge used as a dropdown trigger; the control is the APG menu button
// (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) through the shared Menu. GOV.UK's Tag is
// not the source here, because it forbids an interactive tag.
//
// The interactive badge is its own variant: a visible edge in the text colour (3:1 against the
// tint and the row), a chevron inside the edge, and at least 28 CSS px high and 24 wide, so the
// target passes WCAG 2.5.8. A badge with no allowed transition stays the plain, smaller badge, and
// is not a button.

// Tinted tones draw their edge in the text colour; the solid tones keep their 1 px edge, which is
// already the strong foreground of the tone.
const SOLID = new Set(['critical', 'done']);

export interface StatusBadgeMenuProps<T> {
  status: CollectionStatusValue;
  /** Names the record in the accessible name: "Active, change status of TL-0042". */
  itemName: string;
  /** The records a transition acts on: the row's item. */
  items: T[];
  /** Only the transitions allowed from the current state for this user (§9.6). */
  transitions: CollectionTransition<T>[];
  /** True while a selection exists: the command bar's Change status acts on the selection. */
  disabled?: boolean;
  align?: 'start' | 'end';
}

export function StatusBadgeMenu<T>({
  status,
  itemName,
  items,
  transitions,
  disabled,
  align = 'start',
}: StatusBadgeMenuProps<T>) {
  if (transitions.length === 0) return <Badge tone={status.tone}>{status.label}</Badge>;
  const tone = badgeTone(status.tone);
  const ordered = [
    ...transitions.filter((transition) => !transition.destructive),
    ...transitions.filter((transition) => transition.destructive),
  ];
  const firstDestructive = ordered.findIndex((transition) => transition.destructive);
  return (
    <Menu
      label={`${status.label}, change status of ${itemName}`}
      align={align}
      disabled={disabled}
      chevron={false}
      triggerClassName="group h-auto min-h-7 min-w-6 rounded-badge bg-transparent p-0 hover:bg-transparent disabled:opacity-55"
      trigger={
        <span
          data-status-badge="interactive"
          className={cn(
            BADGE_BASE,
            tone.classes,
            'min-h-7 gap-1 pr-1.5',
            tone.tone !== undefined && SOLID.has(tone.tone) ? undefined : 'border-current',
            'group-hover:underline group-hover:underline-offset-2',
          )}
        >
          {tone.glyph && (
            <span aria-hidden="true" className="text-[0.7rem] leading-none">
              {tone.glyph}
            </span>
          )}
          <span className="truncate">{status.label}</span>
          <ChevronDown aria-hidden="true" data-menu-chevron="" className="h-3.5 w-3.5 shrink-0" />
        </span>
      }
      items={ordered.map((transition, index) => ({
        key: transition.key,
        label: transition.label,
        destructive: transition.destructive,
        separatorBefore: index === firstDestructive,
        onSelect: () => transition.onSelect(items),
      }))}
    />
  );
}
