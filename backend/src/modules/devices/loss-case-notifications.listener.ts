import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LossCustody } from '@prisma/client';
import { OrganizationsService } from '../organizations';
import { STAFF_NOTIFICATIONS, StaffNotifications } from '../platform/ports';
import {
  LOSS_CASE_REPORTED,
  LOSS_CASE_TRIAGED,
  LossCaseReportedEvent,
  LossCaseTriagedEvent,
} from './loss-cases.service';

// After-commit notices of a loss case (task 2.7): TrekLink Staff on a report (REQ-EVT-13) and the
// organization's contact when triage finds RENTER custody and its channel key exposed (api-design 19).
// A failed email is logged and never rolls the case back; there is no retry queue.
@Injectable()
export class LossCaseNotificationsListener {
  private readonly logger = new Logger(LossCaseNotificationsListener.name);

  constructor(
    private readonly organizations: OrganizationsService,
    @Optional() @Inject(STAFF_NOTIFICATIONS) private readonly staff?: StaffNotifications,
  ) {}

  @OnEvent(LOSS_CASE_REPORTED)
  async reported(event: LossCaseReportedEvent): Promise<void> {
    if (!this.staff) return;
    try {
      const delivery = await this.staff.send(
        `TrekLink loss case ${event.code}: ${event.assetTag} reported lost`,
        `${event.assetTag} was reported lost${event.byOrganization ? ' by its renting organization' : ''}. ` +
          `Open loss case ${event.code} in TrekLink to triage it.`,
      );
      if (delivery.accepted === 0) {
        this.logger.warn(`Loss case ${event.code}: no Staff recipient accepted the notice.`);
      }
    } catch (error) {
      this.logger.error(`Loss case ${event.code}: Staff notice failed: ${String(error)}`);
    }
  }

  @OnEvent(LOSS_CASE_TRIAGED)
  async triaged(event: LossCaseTriagedEvent): Promise<void> {
    if (event.custody !== LossCustody.RENTER || !event.organizationId) return;
    try {
      await this.organizations.emailContact(
        event.organizationId,
        `TrekLink loss case ${event.code}: channel key exposed`,
        `${event.assetTag} was lost while in your organization's custody. Its channel key is ` +
          'treated as exposed and must be rotated. The search for the device has ' +
          'started; a confirmed loss is charged at the remaining value on your contract.',
      );
    } catch (error) {
      this.logger.error(`Loss case ${event.code}: organization notice failed: ${String(error)}`);
    }
  }
}
