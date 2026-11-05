import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { DockSessionService } from '../dock/dock-session.service';

// devices.dockSweep (task 10.3, design section 12.8): every 10 seconds, a third of the default
// devices.dockPresenceTtlSeconds, ends each dock session not renewed within the TTL as EXPIRED, so the
// Staff map drops the pin of a unit whose tab closed without ending its session.
@Injectable()
export class DockSweepJob {
  private readonly logger = new Logger(DockSweepJob.name);

  constructor(private readonly sessions: DockSessionService) {}

  @ScheduledJob('devices.dockSweep', '*/10 * * * * *')
  async run(at: Date = new Date()): Promise<{ expired: number }> {
    try {
      return { expired: await this.sessions.expireStale(at) };
    } catch (error) {
      this.logger.error(
        `Dock sessions were not swept: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { expired: 0 };
    }
  }
}
