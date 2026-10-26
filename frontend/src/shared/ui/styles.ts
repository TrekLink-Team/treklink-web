// Class strings shared by the contract and billing pages, in the look of the auth screens. Every
// control shows a visible focus ring for keyboard users (chapter 06 §8.6).
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

export const PRIMARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-lg bg-blue-700 px-4 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
export const SECONDARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
export const DANGER_BUTTON = `inline-flex h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
export const INPUT = `h-11 min-w-0 max-w-full rounded-lg border border-slate-400 bg-white px-3 ${FOCUS}`;
export const LABEL = 'text-sm font-semibold text-slate-900';
export const CARD = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
export const ERROR_TEXT = 'text-sm text-red-700';
export const ALERT = 'rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800';
export const WARNING =
  'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900';
export const LINK = `rounded font-semibold text-blue-700 hover:underline ${FOCUS}`;
export const TAB = (active: boolean) =>
  `h-10 rounded-lg px-4 text-sm font-semibold transition ${FOCUS} ${
    active
      ? 'bg-blue-700 text-white'
      : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
  }`;
// A table that reads as a card: header row tinted, rows separated, amounts right-aligned by the cell.
export const TABLE =
  'w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm';
export const TH =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600';
export const TD = 'px-4 py-3 align-middle';
