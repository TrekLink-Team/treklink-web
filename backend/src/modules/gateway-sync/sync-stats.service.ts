import { Injectable } from '@nestjs/common';
import { SyncOutcome } from '@prisma/client';
import { SyncQueryRepository } from './sync-query.repository';

export interface SyncStats {
  windowMinutes: number;
  accepted: number;
  duplicates: number;
  malformed: number;
  unknownDevice: number;
  lastReceivedAt: Date | null;
  // Devices whose latest queue report is non-empty (REQ-EVT-13).
  devicesBuffering: number;
}

// `gatewaySync.stats(window)` for the system health read of `monitoring` (design §5, api-design 06).
// It reads the same sync audit as `op syncStatus` but answers any caller inside the platform, not only a
// Staff request, and adds the buffering device count.
@Injectable()
export class SyncStatsService {
  constructor(private readonly repository: SyncQueryRepository) {}

  async stats(windowMinutes: number, now = new Date()): Promise<SyncStats> {
    const [outcomes, lastReceivedAt, devicesBuffering] = await Promise.all([
      this.repository.outcomesSince(new Date(now.getTime() - windowMinutes * 60_000)),
      this.repository.lastReceivedAt(),
      this.repository.devicesBuffering(),
    ]);
    const count = (key: SyncOutcome) => outcomes.get(key) ?? 0;
    return {
      windowMinutes,
      accepted: count(SyncOutcome.ACCEPTED),
      duplicates: count(SyncOutcome.DUPLICATE_REJECTED),
      malformed: count(SyncOutcome.MALFORMED_ENVELOPE),
      unknownDevice: count(SyncOutcome.UNKNOWN_DEVICE),
      lastReceivedAt,
      devicesBuffering,
    };
  }
}
