// Class strings of the TrekLink System for pages that style native elements directly. The names
// are kept from the first pages (contracts, billing, auth) so they build unchanged; new code
// prefers the components in this folder (Button, Input, DataTable, ...). Every control shows the
// shared focus ring for keyboard users (chapter 06 §8.6, WCAG 2.4.7).

export const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const CONTROL_BASE =
  'inline-flex h-11 items-center justify-center gap-2 rounded-control px-4 text-body font-semibold transition duration-tl ease-tl disabled:cursor-not-allowed disabled:opacity-55';

export const PRIMARY_BUTTON = `${CONTROL_BASE} tl-press bg-accent font-bold text-on-accent hover:bg-accent-hover active:bg-accent-pressed ${FOCUS}`;
export const SECONDARY_BUTTON = `${CONTROL_BASE} tl-raise border border-line-strong bg-surface text-ink hover:bg-chrome/60 ${FOCUS}`;
export const GHOST_BUTTON = `${CONTROL_BASE} bg-transparent text-ink hover:bg-chrome/60 ${FOCUS}`;
export const DANGER_BUTTON = `${CONTROL_BASE} border border-status-critical-line bg-status-critical-tint text-status-critical-fg hover:bg-status-critical-strong hover:text-status-critical-on ${FOCUS}`;
export const INPUT = `h-11 min-w-0 max-w-full rounded-control border border-line-strong bg-surface px-3 text-body text-ink transition duration-tl ease-tl hover:border-ink-muted aria-[invalid=true]:border-status-critical-fg disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-muted ${FOCUS}`;
export const LABEL = 'text-body-sm font-semibold text-ink';
export const CARD = 'rounded-panel border border-line bg-surface p-5 shadow-raise';
export const ERROR_TEXT = 'text-body-sm font-medium text-status-critical-fg';
export const ALERT =
  'rounded-control border border-status-critical-line bg-status-critical-tint px-3 py-2.5 text-body-sm text-status-critical-fg';
export const WARNING =
  'rounded-control border border-status-attention-line bg-status-attention-tint px-3 py-2.5 text-body-sm text-status-attention-fg';
export const LINK = `rounded-sm font-semibold text-brand underline-offset-4 hover:underline ${FOCUS}`;
export const TAB = (active: boolean) =>
  `h-10 rounded-control px-4 text-body-sm font-semibold transition duration-tl ease-tl ${FOCUS} ${
    active ? 'bg-spark text-on-spark' : 'border border-line-strong bg-surface text-ink hover:bg-chrome/60'
  }`;
// A table that reads as a solid data card: header row sunken, rows separated, amounts right-aligned
// by the cell (DS-07: glass chrome, solid data).
export const TABLE =
  'w-full overflow-hidden rounded-panel border border-line bg-surface text-body shadow-raise';
export const TH =
  'bg-sunken px-4 py-3 text-left text-label uppercase text-ink-muted';
export const TD = 'border-t border-line px-4 py-3 align-middle';
