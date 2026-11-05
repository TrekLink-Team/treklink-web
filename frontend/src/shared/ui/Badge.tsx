import React from 'react';
import { cn } from './cn';
import { BADGE_BASE, badgeTone } from './badgeTone';
import {
  CONFIDENCE_LABEL,
  TONE_GLYPH,
  type IncidentConfidence,
  type StatusEntry,
  type StatusTone,
} from './status';

export interface BadgeProps {
  /** A status tone, or a class string from an entity's *_TONES map. Neutral when absent. */
  tone?: StatusTone | string;
  /** Shows the tone's glyph before the text (on by default for status tones). */
  glyph?: boolean;
  className?: string;
  children: React.ReactNode;
  /**
   * Detail after the badge as muted text ("since 11:20", a date, an amount). The badge itself stays
   * one or two words (chapter 06 §9, design handoff item 12).
   */
  after?: React.ReactNode;
}

/** A small label. For lifecycle states use StatusBadge, which also supplies the text. */
export const Badge: React.FC<BadgeProps> = ({ tone: given, glyph, className, children, after }) => {
  const resolved = badgeTone(given);
  const tone = resolved.tone;
  const known = tone !== undefined;
  const toneClass = resolved.classes;
  const showGlyph = glyph ?? known;
  const badge = (
    <span className={cn(BADGE_BASE, toneClass, className)}>
      {showGlyph && known && (
        <span aria-hidden="true" className="text-[0.7rem] leading-none">
          {TONE_GLYPH[tone]}
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  );
  if (after === undefined || after === null || after === '') return badge;
  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5">
      {badge}
      <span className="text-caption text-ink-muted">{after}</span>
    </span>
  );
};

/**
 * The label and colour of a lifecycle state, from a palette of shared/ui/status.ts:
 * `<StatusBadge entry={CONTRACT_STATUS[contract.status]} />`. Never colour alone (§8.3).
 */
export const StatusBadge: React.FC<{ entry: StatusEntry; className?: string; after?: React.ReactNode }> = ({
  entry,
  className,
  after,
}) => (
  <Badge tone={entry.tone} className={className} after={after}>
    {entry.label}
  </Badge>
);

/**
 * Incident confidence. Confirmed is a solid critical fill; suspected a dashed critical outline with
 * a question mark, so the two differ in shape as well as weight.
 */
export const ConfidenceBadge: React.FC<{ confidence: IncidentConfidence; className?: string }> = ({
  confidence,
  className,
}) =>
  confidence === 'CONFIRMED' ? (
    <Badge tone="critical" className={className}>
      {CONFIDENCE_LABEL.CONFIRMED}
    </Badge>
  ) : (
    <span
      className={cn(
        BADGE_BASE,
        'border-2 border-dashed border-status-critical-fg bg-transparent font-bold text-status-critical-fg',
        className,
      )}
    >
      <span aria-hidden="true" className="leading-none">
        ?
      </span>
      {CONFIDENCE_LABEL.SUSPECTED}
    </span>
  );
