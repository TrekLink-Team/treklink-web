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
// past `reservationExpiresAt` is reminded once. Under the contract lock the job rechecks the status
// and the flag, emails the Manager at the organization's contact address, and writes the flag (a
// SYSTEM transition row) only once the transport accepted the email, so a failed send is retried on
// the next run and two runs never remind twice (review of #108). Staff, who have no notification
// channel yet, see a log line.
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
      const expired = contract.reservationExpiresAt ? stamp(contract.reservationExpiresAt) : '';
      const outcome = await this.events.transaction(async (tx) => {
        const current = await this.contracts.lockById(contract.id, tx);
        if (current.status !== 'APPROVED') return 'skipped';
        if (await this.contracts.hasReminder(contract.id, tx)) return 'skipped';
        const delivered = await this.organizations.emailContact(
          contract.organizationId,
          `TrekLink contract ${contract.code}: reservation expired`,
          `The devices reserved for contract ${contract.code} have waited since ${expired}. ` +
            'Come to the TrekLink counter for the handover, or cancel the request in TrekLink.',
          tx,
        );
        if (!delivered) return 'failed';
        await this.contracts.flagReminded(contract.id, at, tx);
        return 'reminded';
      });
      if (outcome === 'failed') {
        this.logger.warn(
          `Reminder for contract ${contract.code} not delivered; it is retried on the next run`,
        );
        continue;
      }
      if (outcome !== 'reminded') continue;
      reminded += 1;
      this.logger.warn(
        `Reservation of contract ${contract.code} expired ${expired}; the devices are still reserved`,
      );
    }
    return reminded;
  }
}
