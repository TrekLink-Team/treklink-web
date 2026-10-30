import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ScheduledJob } from '../platform/scheduler/scheduled-job.decorator';
import { STAFF_NOTIFICATIONS, StaffNotifications } from '../platform/ports';
import { ContractsRepository, RESERVATION_STAFF_REMINDED } from './contracts.repository';

const ZONE = 'Asia/Ho_Chi_Minh';

const stamp = (at: Date) =>
  at.toLocaleString('en-GB', { timeZone: ZONE, dateStyle: 'medium', timeStyle: 'short' }) +
  ' (UTC+7)';

// rentals.reservationReminders (task 3.2, design §5, REQ-EVT-14, FR-CON-04): an APPROVED contract
// past `reservationExpiresAt` is reminded once. Under the contract lock the job rechecks the status
// and the flag, emails the Manager at the organization's contact address, and writes the flag (a
// SYSTEM transition row) only once the transport accepted the email, so a failed send is retried on
// the next run and concurrent runs see the accepted flag (review of #108). Staff have a separate
// attempt and flag: a Staff failure leaves the Manager's accepted attempt committed. SMTP acceptance
// and a database commit cannot be atomic; a crash between them can repeat a delivered email.
@Injectable()
export class ReservationRemindersJob {
  private readonly logger = new Logger(ReservationRemindersJob.name);

  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
    private readonly events: TransactionalEvents,
    @Optional() @Inject(STAFF_NOTIFICATIONS) private readonly staff?: StaffNotifications,
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
      } else if (outcome === 'reminded') {
        reminded += 1;
        this.logger.warn(
          `Reservation of contract ${contract.code} expired ${expired}; the devices are still reserved`,
        );
      }
      if (this.staff) {
        const delivered = await this.events.transaction(async (tx) => {
          const current = await this.contracts.lockById(contract.id, tx);
          if (
            current.status !== 'APPROVED' ||
            (await this.contracts.hasReminder(contract.id, tx, RESERVATION_STAFF_REMINDED))
          )
            return true;
          const accepted = await this.staff!.send(
            `TrekLink contract ${contract.code}: reservation expired`,
            `The devices reserved for contract ${contract.code} have waited since ${expired}. Contact the organization to arrange the handover or cancellation; the devices remain reserved.`,
            tx,
          );
          if (accepted)
            await this.contracts.flagReminded(contract.id, at, tx, RESERVATION_STAFF_REMINDED);
          return accepted;
        });
        if (!delivered)
          this.logger.warn(
            `Staff reminder for ${contract.code} not delivered; retry on the next run.`,
          );
      }
    }
    return reminded;
  }
}
