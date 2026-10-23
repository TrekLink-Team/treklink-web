import { occurrenceTime } from './occurrence-time';

const receivedAt = new Date('2026-10-23T10:00:00Z');
const limits = { deviceTimeMaxAheadSeconds: 60, lateUploadGraceHours: 168 };
const seconds = (iso: string) => Date.parse(iso) / 1000;

describe('occurrenceTime', () => {
  it('uses a plausible device rx_time (DEVICE_RTC)', () => {
    expect(occurrenceTime(seconds('2026-10-23T03:00:00Z'), receivedAt, limits)).toEqual({
      occurredAt: new Date('2026-10-23T03:00:00Z'),
      timeSource: 'DEVICE_RTC',
      observedAt: new Date('2026-10-23T03:00:00Z'),
    });
  });

  it('falls back to receipt for rx_time 0, stored as unknown (FR-EVT-08)', () => {
    expect(occurrenceTime(0, receivedAt, limits)).toEqual({
      occurredAt: receivedAt,
      timeSource: 'SERVER_RECEIPT',
      observedAt: null,
    });
  });

  it('falls back to receipt for a clock too far ahead or older than the late-upload grace', () => {
    expect(occurrenceTime(seconds('2026-10-23T10:02:00Z'), receivedAt, limits).timeSource).toBe(
      'SERVER_RECEIPT',
    );
    expect(occurrenceTime(seconds('2026-10-15T00:00:00Z'), receivedAt, limits)).toMatchObject({
      timeSource: 'SERVER_RECEIPT',
      observedAt: new Date('2026-10-15T00:00:00Z'),
    });
  });
});
