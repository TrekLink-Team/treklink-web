import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ContractStatus } from '@prisma/client';
import { OrganizationsService } from '../organizations';
import { STAFF_NOTIFICATIONS, StaffNotifications } from '../platform/ports';
import { CONTRACT_STATUS_CHANGED, ContractStatusChangedEvent } from './contract-lifecycle.service';
import { CONTRACT_REQUESTED, ContractRequestedEvent } from './contract-notification.events';
import { ContractsRepository } from './contracts.repository';

const TITLES: Partial<Record<ContractStatus, string>> = {
  APPROVED: 'request approved',
  REJECTED: 'request rejected',
  OVERDUE: 'devices overdue',
  DEFAULTED: 'contract defaulted',
};

// These events run after commit. Email failure is logged and does not roll back the contract.
// Unlike the reservation reminder job, these notices have no persistent retry queue.
@Injectable()
export class ContractNotificationsListener {
  private readonly logger = new Logger(ContractNotificationsListener.name);

  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
    @Optional() @Inject(STAFF_NOTIFICATIONS) private readonly staff?: StaffNotifications,
  ) {}

  @OnEvent(CONTRACT_REQUESTED)
  async requested(event: ContractRequestedEvent): Promise<void> {
    await this.deliver(
      event.contractId,
      async (code) =>
        this.staff?.send(
          `TrekLink contract ${code}: new rental request`,
          `A new rental request ${code} is waiting for review. Open the TrekLink contract requests queue to review availability and arrange the handover.`,
        ) ?? false,
    );
  }

  @OnEvent(CONTRACT_STATUS_CHANGED)
  async changed(event: ContractStatusChangedEvent): Promise<void> {
    const title = TITLES[event.to];
    if (!title) return;
    await this.deliver(event.contractId, async (code) =>
      this.organizations.emailContact(
        event.organizationId,
        `TrekLink contract ${code}: ${title}`,
        `Contract ${code} is now ${event.to}. Open its details in TrekLink for the handover appointment, decision history and outstanding balance. ` +
          (event.to === ContractStatus.OVERDUE
            ? 'Return the devices at the TrekLink counter; late fees apply after the return grace period.'
            : event.to === ContractStatus.DEFAULTED
              ? 'The organization is suspended from new rentals. Contact TrekLink to arrange the return and settle the contract.'
              : 'Contact TrekLink if you need help with this request.'),
      ),
    );
  }

  private async deliver(id: string, send: (code: string) => Promise<boolean> | boolean) {
    try {
      const contract = await this.contracts.detail(id);
      if (!contract || !(await send(contract.code))) {
        this.logger.warn(
          `Contract notification ${id} was not delivered; no automatic retry is queued.`,
        );
      }
    } catch {
      this.logger.warn(`Contract notification ${id} failed; no automatic retry is queued.`);
    }
  }
}
