import { Injectable, Logger } from '@nestjs/common';
import { ContractStatus } from '@prisma/client';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ScheduledJob } from '../platform/scheduler/scheduled-job.decorator';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractsRepository } from './contracts.repository';
import { latestRentalDailyCutoff } from './rental-daily-cutoff';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface OverdueOutcome {
  overdue: number;
  defaulted: number;
  suspended: number;
}

// rentals.overdueAndDefault (task 3.2, design §5, REQ-EVT-13, AC-04, AC-05): a RETURN_DUE contract
// with devices still out once `rentals.returnGraceHours` have passed after `returnDueAt` becomes
// OVERDUE; an OVERDUE contract that stays so for `rentals.defaultAfterDays` becomes DEFAULTED and
// suspends its organization. Candidate thresholds use the latest configured daily cutoff, while the
// stored event times remain the actual run time. Both moves are SYSTEM transitions by compare-and-set, so a re-run after
// downtime moves each contract once. Check-in moves any of the three to RETURNED (rentals 4.1).
@Injectable()
export class OverdueAndDefaultJob {
  private readonly logger = new Logger(OverdueAndDefaultJob.name);

  constructor(
    private readonly contracts: ContractsRepository,
    private readonly lifecycle: ContractLifecycleService,
    private readonly organizations: OrganizationsService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  @ScheduledJob('rentals.overdueAndDefault', '0 15 * * * *')
  async run(at: Date = new Date()): Promise<OverdueOutcome> {
    const outcome: OverdueOutcome = { overdue: 0, defaulted: 0, suspended: 0 };
    const graceHours = await this.parameters.get('rentals.returnGraceHours');
    const defaultAfterDays = await this.parameters.get('rentals.defaultAfterDays');
    const hourLocal = await this.parameters.get('rentals.termRolloverHourLocal');
    const cutoff = latestRentalDailyCutoff(at, hourLocal);

    for (const { id } of await this.contracts.returnDueBefore(
      new Date(cutoff.getTime() - graceHours * HOUR_MS),
    )) {
      await this.events.transaction(async (tx) => {
        const contract = await this.contracts.lockById(id, tx);
        if (contract.status !== ContractStatus.RETURN_DUE) return;
        // Every device back is RETURNED through check-in; nothing out means nothing is overdue.
        if ((await this.contracts.rowsOut(id, tx)).length === 0) return;
        await this.lifecycle.apply(
          id,
          ContractStatus.RETURN_DUE,
          ContractStatus.OVERDUE,
          'GRACE_ELAPSED',
          null,
          tx,
        );
        await this.contracts.stampOverdue(id, { overdueAt: at }, tx);
        outcome.overdue += 1;
      });
    }

    for (const { id } of await this.contracts.overdueBefore(
      new Date(cutoff.getTime() - defaultAfterDays * DAY_MS),
    )) {
      await this.events.transaction(async (tx) => {
        const contract = await this.contracts.lockById(id, tx);
        if (contract.status !== ContractStatus.OVERDUE) return;
        await this.lifecycle.apply(
          id,
          ContractStatus.OVERDUE,
          ContractStatus.DEFAULTED,
          'DEFAULT_THRESHOLD',
          null,
          tx,
        );
        await this.contracts.stampOverdue(id, { defaultedAt: at }, tx);
        outcome.defaulted += 1;
        if (
          await this.organizations.suspendForDefault(contract.organizationId, contract.code, at, tx)
        ) {
          outcome.suspended += 1;
        }
      });
    }

    if (outcome.overdue + outcome.defaulted > 0) {
      this.logger.log(
        `Overdue ${outcome.overdue}, defaulted ${outcome.defaulted}, organizations suspended ${outcome.suspended}`,
      );
    }
    return outcome;
  }
}
