import { Injectable, Logger } from '@nestjs/common';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { StreamRepository } from '../stream.repository';

// Entries deleted per statement, so one run never holds a long lock on the stream table.
export const PRUNE_BATCH_SIZE = 5000;

const HOUR_MS = 3_600_000;

// monitoring.pruneStream (task 2.4, design §3): hourly, delete the stream entries older than
// `monitoring.streamRetentionHours`. Only `stream_events` is touched. The check-in boundary of
// `device_releases` is a table of its own so that a late upload can still be recognised after its
// stream entry is gone (168 h of grace against 72 h of retention). A re-run finds nothing more to delete.
@Injectable()
export class PruneStreamJob {
  private readonly logger = new Logger(PruneStreamJob.name);

  constructor(
    private readonly repository: StreamRepository,
    private readonly parameters: ParameterService,
  ) {}

  @ScheduledJob('monitoring.pruneStream', '0 10 * * * *')
  async run(at: Date = new Date()): Promise<number> {
    const hours = await this.parameters.get('monitoring.streamRetentionHours');
    const cutoff = new Date(at.getTime() - hours * HOUR_MS);
    let total = 0;
    for (;;) {
      const deleted = await this.repository.pruneBefore(cutoff, PRUNE_BATCH_SIZE);
      total += deleted;
      if (deleted < PRUNE_BATCH_SIZE) break;
    }
    if (total > 0) this.logger.log(`Pruned ${total} stream entries older than ${hours} h`);
    return total;
  }
}
