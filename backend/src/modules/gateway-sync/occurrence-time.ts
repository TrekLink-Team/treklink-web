import { TimeSource } from '@prisma/client';
import type { StationTimes } from './canonical-envelope';

export interface OccurrenceTime {
  occurredAt: Date;
  timeSource: TimeSource;
  observedAt: Date | null; // the device rx_time; null when 0 (FR-EVT-08)
}

// REQ-UBI-06: STATION_CORRECTED for a Field Station publish, its `fs_captured_at` plus the offset
// `receivedAt - fs_sent_at` of the same publish (D-040; transit time makes it slightly late, never
// early); else DEVICE_RTC when rx_time is non-zero and inside
// [receivedAt - lateUploadGraceHours, receivedAt + deviceTimeMaxAheadSeconds]; else SERVER_RECEIPT.
export const occurrenceTime = (
  rxTimeSeconds: number,
  receivedAt: Date,
  limits: { deviceTimeMaxAheadSeconds: number; lateUploadGraceHours: number },
  station?: StationTimes,
): OccurrenceTime => {
  const observedAt = rxTimeSeconds > 0 ? new Date(rxTimeSeconds * 1000) : null;
  if (station) {
    const occurredAt = new Date(station.capturedAtMs + receivedAt.getTime() - station.sentAtMs);
    return { occurredAt, timeSource: TimeSource.STATION_CORRECTED, observedAt };
  }
  if (observedAt) {
    const latest = receivedAt.getTime() + limits.deviceTimeMaxAheadSeconds * 1000;
    const earliest = receivedAt.getTime() - limits.lateUploadGraceHours * 3_600_000;
    if (observedAt.getTime() <= latest && observedAt.getTime() >= earliest) {
      return { occurredAt: observedAt, timeSource: TimeSource.DEVICE_RTC, observedAt };
    }
  }
  return { occurredAt: receivedAt, timeSource: TimeSource.SERVER_RECEIPT, observedAt };
};
