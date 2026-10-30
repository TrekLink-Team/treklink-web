import { Injectable, Logger } from '@nestjs/common';
import { ContractStatus, PlanType } from '@prisma/client';
import { InvoicesService } from '../billing';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ScheduledJob } from '../platform/scheduler/scheduled-job.decorator';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { addMonths } from './contract-terms';
import { ContractsRepository } from './contracts.repository';
import { latestRentalDailyCutoff } from './rental-daily-cutoff';

export interface RolloverOutcome {
  renewed: number;
  returnDue: number;
  returned: number;
}

// rentals.termRollover (task 3.1, design §5; MF-05): every open term due by the latest daily cutoff closes
// once, by compare-and-set. A monthly contract with no notice opens the next term with its invoice; a
// monthly contract under notice (ENDING) and a day plan move to RETURN_DUE with the term end as
// returnDueAt, and straight on to RETURNED when every device is already back or lost. A re-run after
// downtime finds each term closed and does nothing (REQ-UBI-03).
@Injectable()
export class TermRolloverJob {
  private readonly logger = new Logger(TermRolloverJob.name);

  constructor(
    private readonly contracts: ContractsRepository,
    private readonly lifecycle: ContractLifecycleService,
    private readonly invoices: InvoicesService,
    private readonly devices: DevicesService,
    private readonly events: TransactionalEvents,
    private readonly parameters: ParameterService,
  ) {}

  // Hourly wakeups catch up only daily batches already due at the configured local-hour boundary.
  @ScheduledJob('rentals.termRollover', '0 5 * * * *')
  async run(at: Date = new Date()): Promise<RolloverOutcome> {
    const outcome: RolloverOutcome = { renewed: 0, returnDue: 0, returned: 0 };
    const hourLocal = await this.parameters.get('rentals.termRolloverHourLocal');
    const cutoff = latestRentalDailyCutoff(at, hourLocal);
    const due = await this.contracts.dueTerms(cutoff);
    if (due.length === 0) return outcome;
    const variants = await this.devices.variants(false);

    for (const term of due) {
      await this.events.transaction(async (tx) => {
        const contract = await this.contracts.lockById(term.contractId, tx);
        if (!(await this.contracts.closeTerm(term.id, tx))) return;

        const renews =
          contract.status === ContractStatus.ACTIVE && contract.planType === PlanType.MONTHLY;
        if (renews) {
          const startsAt = term.endsAt;
          const next = await this.contracts.insertTerm(
            {
              contractId: contract.id,
              seq: term.seq + 1,
              startsAt,
              endsAt: addMonths(startsAt, 1),
            },
            tx,
          );
          await this.invoices.issueTermInvoice(
            {
              id: contract.id,
              organizationId: contract.organizationId,
              quantity: contract.quantity,
              monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
              holdingFeeRatio: contract.holdingFeeRatio,
              variantCode:
                variants.find((variant) => variant.id === contract.hardwareVariantId)?.code ??
                contract.hardwareVariantId,
            },
            next,
            tx,
            at,
          );
          outcome.renewed += 1;
          return;
        }

        await this.contracts.setReturnDueAt(contract.id, term.endsAt, tx);
        await this.lifecycle.apply(
          contract.id,
          contract.status,
          ContractStatus.RETURN_DUE,
          'TERM_ENDED',
          null,
          tx,
        );
        outcome.returnDue += 1;
        const { total, returned } = await this.contracts.returnCounts(contract.id, tx);
        if (total > 0 && returned === total) {
          await this.lifecycle.apply(
            contract.id,
            ContractStatus.RETURN_DUE,
            ContractStatus.RETURNED,
            'ALL_DEVICES_BACK',
            null,
            tx,
          );
          outcome.returned += 1;
        }
      });
    }
    this.logger.log(
      `Term rollover: ${outcome.renewed} renewed, ${outcome.returnDue} to RETURN_DUE, ${outcome.returned} to RETURNED.`,
    );
    return outcome;
  }
}
