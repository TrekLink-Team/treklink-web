import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { STAFF_NOTIFICATIONS, StaffNotifications } from '../platform/ports';
import {
  ORGANIZATION_REGISTERED,
  ORGANIZATION_STATUS_CHANGED,
  ORGANIZATION_VERIFIED,
  type OrganizationRegisteredEvent,
  type OrganizationStatusChangedEvent,
  type OrganizationVerifiedEvent,
} from './organization-events';
import { OrganizationsService } from './organizations.service';

// The notices of onboarding (REQ-EVT-01 to REQ-EVT-03), sent after the commit that caused them. Staff
// are told of a registration, Staff and Admin of a verification that awaits approval (the port
// STAFF_NOTIFICATIONS reaches every active Staff and Admin account), and the Manager of an approval
// (MSG05) or a rejection (MSG16). A failed send is logged and never thrown: the change is already
// saved and there is no retry queue, as for the contract notices of `rentals`.
@Injectable()
export class OnboardingNotifier {
  private readonly logger = new Logger(OnboardingNotifier.name);

  constructor(
    private readonly organizations: OrganizationsService,
    @Optional() @Inject(STAFF_NOTIFICATIONS) private readonly staff?: StaffNotifications,
  ) {}

  @OnEvent(ORGANIZATION_REGISTERED)
  async onRegistered(event: OrganizationRegisteredEvent): Promise<void> {
    await this.tellStaff(
      event.organizationId,
      `TrekLink organization ${event.code}: new registration`,
      `${event.legalName} registered as ${event.code}. Verify it at the counter or by phone, then record the verification in the TrekLink organization review page.`,
    );
  }

  @OnEvent(ORGANIZATION_VERIFIED)
  async onVerified(event: OrganizationVerifiedEvent): Promise<void> {
    await this.tellStaff(
      event.organizationId,
      `TrekLink organization ${event.code}: awaiting approval`,
      `${event.legalName} (${event.code}) is verified and awaits approval. An Admin can approve or reject it in the TrekLink organization review page.`,
    );
  }

  @OnEvent(ORGANIZATION_STATUS_CHANGED)
  async onStatusChanged(event: OrganizationStatusChangedEvent): Promise<void> {
    if (event.from !== 'PENDING') return;
    if (event.to === 'ACTIVE') {
      await this.tellManager(
        event.organizationId,
        'TrekLink organization approved',
        'Your organization is approved. You can now invite members and request devices.',
      );
    } else if (event.to === 'REJECTED') {
      await this.tellManager(
        event.organizationId,
        'TrekLink organization request not accepted',
        `Your request was not accepted: ${event.reason ?? 'no reason was given'}.`,
      );
    }
  }

  private async tellStaff(organizationId: string, subject: string, text: string): Promise<void> {
    try {
      const delivery = (await this.staff?.send(subject, text)) ?? { accepted: 0, failed: 0 };
      if (delivery.accepted === 0) {
        this.logger.warn(`Notice for organization ${organizationId} reached no Staff or Admin.`);
      }
    } catch (error) {
      this.logger.warn(`Notice for organization ${organizationId} failed: ${String(error)}`);
    }
  }

  private async tellManager(organizationId: string, subject: string, text: string): Promise<void> {
    try {
      if (!(await this.organizations.emailContact(organizationId, subject, text))) {
        this.logger.warn(`Email to the Manager of organization ${organizationId} was not sent.`);
      }
    } catch (error) {
      this.logger.warn(`Email to the Manager of ${organizationId} failed: ${String(error)}`);
    }
  }
}
