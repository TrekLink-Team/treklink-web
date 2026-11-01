import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '../platform/scheduler/scheduled-job.decorator';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractsRepository } from './contracts.repository';

// rentals.requestHoldExpiry (D-092 rule 1, REQ-EVT-17, design §2.1 and §5): every ten minutes, each
// REQUESTED contract past `holdExpiresAt` is handed to ContractDecisionsService.expireHold, which
// rechecks the status, the expiry and the first payment under the contract lock in its own
// transaction, so a paid deposit keeps the hold and a re-run or a concurrent run changes nothing
// twice. One contract failing is logged and does not stop the others.
@Injectable()
export class RequestHoldExpiryJob {
  private readonly logger = new Logger(RequestHoldExpiryJob.name);

  constructor(
    private readonly contracts: ContractsRepository,
    private readonly decisions: ContractDecisionsService,
  ) {}

  @ScheduledJob('rentals.requestHoldExpiry', '0 */10 * * * *')
  async run(at: Date = new Date()): Promise<number> {
    let cancelled = 0;
    for (const contract of await this.contracts.expiredHolds(at)) {
      try {
        if (await this.decisions.expireHold(contract.id, at)) {
          cancelled += 1;
          this.logger.log(`Hold of ${contract.code} expired unpaid; the request is cancelled`);
        }
      } catch (error) {
        this.logger.error(
          `Hold expiry of ${contract.code} failed; it is retried on the next run`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return cancelled;
  }
}
