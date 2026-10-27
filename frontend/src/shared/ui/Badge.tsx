import React from 'react';
import { cn } from './cn';
import {
  CONFIDENCE_LABEL,
  TONE_CLASSES,
  TONE_GLYPH,
  type IncidentConfidence,
  type StatusEntry,
  type StatusTone,
} from './status';

const BADGE_BASE =
  'inline-flex w-fit max-w-full items-center gap-1.5 whitespace-nowrap rounded-badge border px-2 py-0.5 text-caption';

export interface BadgeProps {
  /** A status tone, or a class string from an entity's *_TONES map. Neutral when absent. */
  tone?: StatusTone | string;
  /** Shows the tone's glyph before the text (on by default for status tones). */
  glyph?: boolean;
  className?: string;
  children: React.ReactNode;
}

const isTone = (tone: string): tone is StatusTone => Object.hasOwn(TONE_CLASSES, tone);

// Entities pass the class string of a tone (STATUS_TONES); map it back so the glyph shows too.
const toneOfClass = (classes: string): StatusTone | undefined =>
  (Object.keys(TONE_CLASSES) as StatusTone[]).find((key) => TONE_CLASSES[key] === classes);

/** A small label. For lifecycle states use StatusBadge, which also supplies the text. */
export const Badge: React.FC<BadgeProps> = ({ tone: given, glyph, className, children }) => {
  const tone = given !== undefined && !isTone(given) ? (toneOfClass(given) ?? given) : given;
  const known = tone !== undefined && isTone(tone);
  const toneClass = known ? TONE_CLASSES[tone] : tone ?? 'border-line bg-sunken font-semibold text-ink';
  const showGlyph = glyph ?? known;
  return (
    <span className={cn(BADGE_BASE, toneClass, className)}>
      {showGlyph && known && (
        <span aria-hidden="true" className="text-[0.7rem] leading-none">
          {TONE_GLYPH[tone]}
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  );
};

/**
 * The label and colour of a lifecycle state, from a palette of shared/ui/status.ts:
 * `<StatusBadge entry={CONTRACT_STATUS[contract.status]} />`. Never colour alone (§8.3).
 */
export const StatusBadge: React.FC<{ entry: StatusEntry; className?: string }> = ({ entry, className }) => (
  <Badge tone={entry.tone} className={className}>
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
