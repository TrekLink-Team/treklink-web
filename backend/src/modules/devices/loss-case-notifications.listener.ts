import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { STAFF_NOTIFICATIONS, StaffNotifications } from '../platform/ports';
import { LOSS_CASE_REPORTED, LossCaseReportedEvent } from './loss-cases.service';

// After-commit notice of a loss case (task 2.7): TrekLink Staff on a report (REQ-EVT-13). The Managers
// hear of an exposed key from organizations (KeyExposedNotifier, after markKeyExposed). A failed email is
// logged and never rolls the case back; there is no retry queue.
@Injectable()
export class LossCaseNotificationsListener {
  private readonly logger = new Logger(LossCaseNotificationsListener.name);

  constructor(
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
}
