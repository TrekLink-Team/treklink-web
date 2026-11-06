// The text model of the shared money input (chapter 06 §11.10, D-101, ui standard §4): VND amounts read
// in the vi-VN form `1.000.000 ₫` with dots grouping the thousands, while the value the forms keep and send
// stays a string of plain digits ('' when empty), an integer of VND. Pure functions, so the component and
// its tests share one model.

/** The digits of a VND amount grouped with dots: '1500000' gives '1.500.000'. */
export const groupVnd = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** The amount as the vi-VN money text: '1500000' gives '1.500.000 ₫'. */
export const formatMoney = (digits: string): string => (digits === '' ? '' : `${groupVnd(digits)} ₫`);

const MULTIPLIER: Record<string, number> = { k: 1_000, nghin: 1_000, 'nghìn': 1_000, tr: 1_000_000, m: 1_000_000 };

// A number with an optional decimal part (dot or comma, one or two digits) and a shorthand unit: 150k,
// 1.5tr, 1,5tr, 2m. Three digits after a separator are a thousands group, so `1.500k` is 1500k.
const SHORTHAND = /^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(k|tr|m|nghìn|nghin)$/i;

const stripLeadingZeros = (digits: string): string => digits.replace(/^0+(?=\d)/, '').replace(/^0$/, '0');

/**
 * Reads money text typed or pasted in any common form, or null when it is not an amount.
 * `1.000.000 ₫`, `1,000,000`, `1000000đ`, `1 000 000 VND` give '1000000'; `150k` gives '150000';
 * `1.5tr` and `1,5tr` give '1500000'; a fraction after grouped thousands (`1.000.000,50`) is dropped.
 */
export const parseMoneyText = (text: string): string | null => {
  const cleaned = text
    .trim()
    .replace(/(₫|đ|vnd|dong|đồng)$/i, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (cleaned === '') return '';
  const short = SHORTHAND.exec(cleaned);
  if (short) {
    const [, whole, fraction = '', unit] = short;
    const multiplier = MULTIPLIER[unit.toLowerCase()];
    const value = Math.round(Number(`${whole.replace(/\D/g, '')}.${fraction || '0'}`) * multiplier);
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  if (!/^[\d.,]+$/.test(cleaned)) return null;
  // A fraction after grouped thousands: VND has no minor unit, so it is dropped.
  const grouped = /^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.exec(cleaned);
  const integer = grouped && grouped[2] ? cleaned.slice(0, -grouped[2].length) : cleaned;
  const digits = integer.replace(/\D/g, '');
  return digits === '' ? null : stripLeadingZeros(digits);
};

// Text the person is still typing toward a shorthand, shown as typed: the kept amount followed by a dot or
// comma and up to two digits ("1.", "1.5", "1,5"), or by the start of a unit ("1.5t", "150n"). The number
// before the separator or unit must be the amount already kept, so deleting a digit from "1.500" (giving
// "1.50") regroups instead of reading as a decimal.
const PENDING = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:([.,])(\d{0,2}))?\s*(t|n|ng|ngh|nghi|nghì)?$/i;
const isPending = (raw: string, previousDigits: string): boolean => {
  const match = PENDING.exec(raw.trim());
  if (!match) return false;
  const [, whole, separator, , unit] = match;
  if (!separator && !unit) return false;
  return whole.replace(/\D/g, '') === previousDigits;
};

export interface MoneyEdit {
  /** What the field shows. */
  text: string;
  /** The digits the form keeps; unchanged while a shorthand is still being typed. */
  digits: string;
  /** Where the caret goes in `text`. */
  caret: number;
}

/**
 * The field after one edit: the raw text the browser produced and the caret in it. Plain digits are
 * regrouped and the caret stays after the same number of digits; a finished shorthand is converted with
 * the caret at the end; a shorthand still being typed is shown as typed.
 */
export const applyMoneyEdit = (raw: string, caret: number, previousDigits: string): MoneyEdit => {
  const short = SHORTHAND.exec(raw.trim().replace(/\s+/g, '').toLowerCase());
  if (short) {
    const digits = parseMoneyText(raw) ?? previousDigits;
    const text = groupVnd(digits);
    return { text, digits, caret: text.length };
  }
  if (isPending(raw, previousDigits)) return { text: raw, digits: previousDigits, caret };
  const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
  let digits = raw.replace(/\D/g, '');
  const stripped = digits.length - stripLeadingZeros(digits).length;
  digits = stripLeadingZeros(digits);
  const text = groupVnd(digits);
  return { text, digits, caret: caretAfterDigits(text, Math.max(0, digitsBefore - stripped)) };
};

/** The position in grouped text just after its `count`-th digit (0 is the start). */
export const caretAfterDigits = (text: string, count: number): number => {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/\d/.test(text[i])) seen += 1;
    if (seen === count) return i + 1;
  }
  return text.length;
};

/** The digits with three zeros appended (the "000" button); nothing to append to stays empty. */
export const appendThousand = (digits: string): string => (digits === '' || digits === '0' ? digits : `${digits}000`);
