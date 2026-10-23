import { TimeSource } from '@prisma/client';

export interface OccurrenceTime {
  occurredAt: Date;
  timeSource: TimeSource;
  observedAt: Date | null; // the device rx_time; null when 0 (FR-EVT-08)
}

// REQ-UBI-06 without a Field Station: DEVICE_RTC when rx_time is non-zero and inside
// [receivedAt - lateUploadGraceHours, receivedAt + deviceTimeMaxAheadSeconds], else SERVER_RECEIPT.
// STATION_CORRECTED joins with the Field Station adapter (task 2.4, Sprint 4).
export const occurrenceTime = (
  rxTimeSeconds: number,
  receivedAt: Date,
  limits: { deviceTimeMaxAheadSeconds: number; lateUploadGraceHours: number },
): OccurrenceTime => {
  const observedAt = rxTimeSeconds > 0 ? new Date(rxTimeSeconds * 1000) : null;
  if (observedAt) {
    const latest = receivedAt.getTime() + limits.deviceTimeMaxAheadSeconds * 1000;
    const earliest = receivedAt.getTime() - limits.lateUploadGraceHours * 3_600_000;
    if (observedAt.getTime() <= latest && observedAt.getTime() >= earliest) {
      return { occurredAt: observedAt, timeSource: TimeSource.DEVICE_RTC, observedAt };
    }
  }
  return { occurredAt: receivedAt, timeSource: TimeSource.SERVER_RECEIPT, observedAt };
};
