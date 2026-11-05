import { HttpStatus } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';

// The write rules of a hardware variant (specs/devices/design.md sections 10 and 11, devices
// api-design 02 and 03). Pure functions, so the service and its tests share one definition.

export interface ScheduleRow {
  fromMonths: number;
  valueVnd: number;
}

const scheduleInvalid = () =>
  new DomainException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.SCHEDULE_INVALID,
    'remainingValueSchedule must start at 0 months and never increase.',
  );

const isWholeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

// REQ-ERR-19: at least one row, the first at month 0, months strictly increasing, values never
// increasing with age. Only the two known keys are kept.
export const checkSchedule = (value: unknown): ScheduleRow[] => {
  if (!Array.isArray(value) || value.length === 0) throw scheduleInvalid();
  const rows = value.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) throw scheduleInvalid();
    const { fromMonths, valueVnd } = row as Record<string, unknown>;
    if (!isWholeNumber(fromMonths) || !isWholeNumber(valueVnd)) throw scheduleInvalid();
    return { fromMonths, valueVnd };
  });
  if (rows[0].fromMonths !== 0) throw scheduleInvalid();
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].fromMonths <= rows[i - 1].fromMonths || rows[i].valueVnd > rows[i - 1].valueVnd) {
      throw scheduleInvalid();
    }
  }
  return rows;
};

// REQ-ERR-10: a service interval needs at least one checklist item.
export const checkServicePlan = (intervalDays: number | null, checklist: readonly string[]) => {
  if (intervalDays !== null && checklist.length === 0) {
    throw new DomainException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.CHECKLIST_REQUIRED,
      'Add at least one service checklist item.',
    );
  }
};

export const SPEC_SHEET_KEYS = [
  'mcu',
  'radio',
  'gnss',
  'motionSensor',
  'display',
  'battery',
  'sosControl',
  'localAlarm',
  'enclosure',
] as const;

const SPEC_VALUE_MAX = 80;
const IMAGE_URL_MAX = 500;
const APP_PATH = /^\/variants\/([^/]+)$/;
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

const mediaInvalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VARIANT_MEDIA_INVALID, message);

// REQ-ERR-18: an https URL with a host, or `/variants/<file>` with no `/` or `..` in the file name and
// an image extension; null or an empty string clears the link.
export const checkImageUrl = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw mediaInvalid('Use an https link or /variants/<file>.');
  const url = value.trim();
  if (url === '') return null;
  if (url.length > IMAGE_URL_MAX)
    throw mediaInvalid('The image link is longer than 500 characters.');
  const appPath = APP_PATH.exec(url);
  if (appPath) {
    if (appPath[1].includes('..') || !IMAGE_FILE.test(appPath[1])) {
      throw mediaInvalid('Use an https link or /variants/<file>.');
    }
    return url;
  }
  if (url.startsWith('https://')) {
    try {
      if (new URL(url).hostname !== '') return url;
    } catch {
      // falls through to the refusal below
    }
  }
  throw mediaInvalid('Use an https link or /variants/<file>.');
};

// REQ-ERR-18: keys from the fixed list only, each value a string of 1 to 80 characters after
// trimming. The stored sheet keeps the trimmed values in the fixed key order.
export const checkSpecSheet = (value: unknown): Record<string, string> => {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw mediaInvalid('The spec sheet must be an object of text entries.');
  }
  const sheet = value as Record<string, unknown>;
  const known = new Set<string>(SPEC_SHEET_KEYS);
  const unknown = Object.keys(sheet).find((key) => !known.has(key));
  if (unknown !== undefined) throw mediaInvalid(`${unknown} is not a spec sheet entry.`);
  const result: Record<string, string> = {};
  for (const key of SPEC_SHEET_KEYS) {
    if (!(key in sheet)) continue;
    const entry = sheet[key];
    const text = typeof entry === 'string' ? entry.trim() : '';
    if (text === '' || text.length > SPEC_VALUE_MAX) {
      throw mediaInvalid(`${key} must be 1 to 80 characters.`);
    }
    result[key] = text;
  }
  return result;
};
