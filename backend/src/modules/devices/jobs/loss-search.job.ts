import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { LossCasesRepository } from '../loss-cases.repository';
import { LossCaseService } from '../loss-cases.service';

// devices.lossSearch (task 2.7, design §2.1, REQ-EVT-15): hourly, confirms every SEARCHING case whose
// `searchEndsAt` has passed, as SYSTEM. Each case is its own transaction with the compare-and-set of
// LossCaseService, so a case Staff confirmed or recovered meanwhile is skipped and a re-run after
// downtime confirms each case once. One failing case is logged and does not stop the others.
@Injectable()
export class LossSearchJob {
  private readonly logger = new Logger(LossSearchJob.name);

  constructor(
    private readonly cases: LossCasesRepository,
    private readonly lossCases: LossCaseService,
  ) {}

  @ScheduledJob('devices.lossSearch', '0 20 * * * *')
  async run(at: Date = new Date()): Promise<{ confirmed: number }> {
    let confirmed = 0;
    for (const id of await this.cases.dueForConfirmation(at)) {
      try {
        if (await this.lossCases.confirmDue(id, at)) confirmed += 1;
      } catch (error) {
        this.logger.error(
          `Loss case ${id} was not confirmed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { confirmed };
  }
}
