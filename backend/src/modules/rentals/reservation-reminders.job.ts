import { Injectable, Logger } from '@nestjs/common';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ScheduledJob } from '../platform/scheduler/scheduled-job.decorator';
import { ContractsRepository } from './contracts.repository';

const ZONE = 'Asia/Ho_Chi_Minh';

const stamp = (at: Date) =>
  at.toLocaleString('en-GB', { timeZone: ZONE, dateStyle: 'medium', timeStyle: 'short' }) +
  ' (UTC+7)';

// rentals.reservationReminders (task 3.2, design §5, REQ-EVT-14, FR-CON-04): an APPROVED contract
// past `reservationExpiresAt` is reminded once. The flag is a SYSTEM transition row in the same
// transaction, written before the email goes out after commit; the Manager is emailed at the
// organization's contact address, and Staff, who have no notification channel yet, see a log line.
@Injectable()
export class ReservationRemindersJob {
  private readonly logger = new Logger(ReservationRemindersJob.name);

  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
    private readonly events: TransactionalEvents,
  ) {}

  @ScheduledJob('rentals.reservationReminders', '0 25 * * * *')
  async run(at: Date = new Date()): Promise<number> {
    let reminded = 0;
    for (const contract of await this.contracts.reservationsToRemind(at)) {
      const flagged = await this.events.transaction(async (tx) => {
        const current = await this.contracts.lockById(contract.id, tx);
        if (current.status !== 'APPROVED') return false;
        await this.contracts.flagReminded(contract.id, at, tx);
        return true;
      });
      if (!flagged) continue;
      reminded += 1;
      const expired = contract.reservationExpiresAt ? stamp(contract.reservationExpiresAt) : '';
      this.logger.warn(
        `Reservation of contract ${contract.code} expired ${expired}; the devices are still reserved`,
      );
      await this.organizations.emailContact(
        contract.organizationId,
        `TrekLink contract ${contract.code}: reservation expired`,
        `The devices reserved for contract ${contract.code} have waited since ${expired}. ` +
          'Come to the TrekLink counter for the handover, or cancel the request in TrekLink.',
      );
    }
    return reminded;
  }
}
