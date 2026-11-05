import { DomainException, ErrorCode } from '../../common/errors';
import { checkImageUrl, checkSchedule, checkServicePlan, checkSpecSheet } from './variant-rules';

const codeOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return (error as DomainException).errorCode;
  }
  return 'no error';
};

describe('variant rules (design sections 10 and 11)', () => {
  it('accepts a schedule from month 0 with increasing months and values that never rise', () => {
    expect(
      checkSchedule([
        { fromMonths: 0, valueVnd: 2500000, extra: 1 },
        { fromMonths: 12, valueVnd: 1800000 },
        { fromMonths: 24, valueVnd: 1800000 },
      ]),
    ).toEqual([
      { fromMonths: 0, valueVnd: 2500000 },
      { fromMonths: 12, valueVnd: 1800000 },
      { fromMonths: 24, valueVnd: 1800000 },
    ]);
  });

  it.each([
    ['empty', []],
    ['not a list', { fromMonths: 0 }],
    ['first row after month 0', [{ fromMonths: 1, valueVnd: 10 }]],
    [
      'a value rising with age',
      [
        { fromMonths: 0, valueVnd: 10 },
        { fromMonths: 6, valueVnd: 11 },
      ],
    ],
    [
      'months repeated',
      [
        { fromMonths: 0, valueVnd: 10 },
        { fromMonths: 0, valueVnd: 9 },
      ],
    ],
    ['a negative value', [{ fromMonths: 0, valueVnd: -1 }]],
    ['a fraction', [{ fromMonths: 0, valueVnd: 1.5 }]],
  ])('refuses a schedule that is %s with SCHEDULE_INVALID', (_, value) => {
    expect(codeOf(() => checkSchedule(value))).toBe(ErrorCode.SCHEDULE_INVALID);
  });

  it('needs a checklist item when a service interval is set (REQ-ERR-10)', () => {
    expect(codeOf(() => checkServicePlan(180, []))).toBe(ErrorCode.CHECKLIST_REQUIRED);
    expect(codeOf(() => checkServicePlan(180, ['Battery']))).toBe('no error');
    expect(codeOf(() => checkServicePlan(null, []))).toBe('no error');
  });

  it('accepts an https link or an app path under /variants/, and clears on null or empty (AC-21)', () => {
    expect(checkImageUrl('/variants/treklink-v4.jpg')).toBe('/variants/treklink-v4.jpg');
    expect(checkImageUrl(' https://cdn.example.com/a.png ')).toBe('https://cdn.example.com/a.png');
    expect(checkImageUrl(null)).toBeNull();
    expect(checkImageUrl('')).toBeNull();
  });

  it.each([
    'http://example.com/a.jpg',
    '/variants/../x.jpg',
    '//host/a.jpg',
    '/variants/a.gif',
    '/variants/sub/a.png',
    `https://example.com/${'a'.repeat(500)}.png`,
  ])('refuses the image link %s with VARIANT_MEDIA_INVALID', (url) => {
    expect(codeOf(() => checkImageUrl(url))).toBe(ErrorCode.VARIANT_MEDIA_INVALID);
  });

  it('keeps the spec sheet trimmed in the fixed key order', () => {
    expect(checkSpecSheet({ localAlarm: ' LED ', mcu: 'ESP32-S3' })).toEqual({
      mcu: 'ESP32-S3',
      localAlarm: 'LED',
    });
    expect(Object.keys(checkSpecSheet({ localAlarm: 'LED', mcu: 'ESP32' }))).toEqual([
      'mcu',
      'localAlarm',
    ]);
  });

  it.each([
    ['an unknown key', { colour: 'grey' }],
    ['a blank value', { mcu: '  ' }],
    ['a value that is not text', { mcu: 3 }],
    ['a value above 80 characters', { mcu: 'x'.repeat(81) }],
    ['a list', ['mcu']],
  ])('refuses a spec sheet with %s with VARIANT_MEDIA_INVALID', (_, sheet) => {
    expect(codeOf(() => checkSpecSheet(sheet))).toBe(ErrorCode.VARIANT_MEDIA_INVALID);
  });
});
