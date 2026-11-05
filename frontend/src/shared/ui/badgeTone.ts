import { TONE_CLASSES, TONE_GLYPH, type StatusTone } from './status';

// The badge base classes and the tone resolution, shared by Badge and the interactive status badge
// of chapter 06 §11.3 (collection-view/StatusBadgeMenu.tsx).

export const BADGE_BASE =
  'inline-flex w-fit max-w-full items-center gap-1.5 whitespace-nowrap rounded-badge border px-2 py-0.5 text-caption';

const isTone = (tone: string): tone is StatusTone => Object.hasOwn(TONE_CLASSES, tone);

// Entities pass the class string of a tone (STATUS_TONES); map it back so the glyph shows too.
const toneOfClass = (classes: string): StatusTone | undefined =>
  (Object.keys(TONE_CLASSES) as StatusTone[]).find((key) => TONE_CLASSES[key] === classes);

const NEUTRAL = 'border-line bg-sunken font-semibold text-ink';

/** The classes and glyph of a badge tone: a status tone, an entity's class string, or neutral. */
export const badgeTone = (given: StatusTone | string | undefined) => {
  const tone = given !== undefined && !isTone(given) ? (toneOfClass(given) ?? given) : given;
  const known = tone !== undefined && isTone(tone) ? tone : undefined;
  return {
    tone: known,
    classes: known ? TONE_CLASSES[known] : (tone ?? NEUTRAL),
    glyph: known ? TONE_GLYPH[known] : undefined,
  };
};

