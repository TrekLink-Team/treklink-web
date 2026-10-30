import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainException, ErrorCode } from '../../../common/errors';
import { MEMBER_DEACTIVATED, type MemberDeactivatedEvent } from '../../auth';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { IncidentLifecycle } from '../incident-lifecycle';
import { IncidentsRepository } from '../incidents.repository';
import { RoutingService } from '../routing.service';

// A human action or an SOS moved the incident after it was read: that move stands.
const lostRace = (error: unknown): boolean =>
  error instanceof DomainException &&
  (error.errorCode === ErrorCode.STALE_VERSION ||
    error.errorCode === ErrorCode.INVALID_STATE_TRANSITION);

// Task 4.2, the owner deactivation (REQ-EVT-11, D-034). When a member is deactivated, every
// ACKNOWLEDGED or RESPONDING incident they own goes back to NOTIFY_BACKUP as SYSTEM and alerts that
// tier; the lifecycle skips an empty tier. The member is already off the roster when the event
// arrives (organizations clears the shifts in the same commit), so the tiers read here exclude them.
// One transaction per incident, so one failure does not hold back the others; a failed one is
// logged, and its status deadline still escalates it (REQ-EVT-07).
@Injectable()
export class OwnerDeactivationListener {
  private readonly logger = new Logger(OwnerDeactivationListener.name);

  constructor(
    private readonly incidents: IncidentsRepository,
    private readonly lifecycle: IncidentLifecycle,
    private readonly routing: RoutingService,
    private readonly events: TransactionalEvents,
  ) {}

  @OnEvent(MEMBER_DEACTIVATED)
  async onMemberDeactivated({ userId }: MemberDeactivatedEvent): Promise<number> {
    // An event handler has no caller to reject to, so a failed read is logged like a failed move.
    const owned = await this.incidents.ownedActive(userId).catch((error: unknown) => {
      this.logger.error(
        `Owned incidents of ${userId} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    });
    let moved = 0;
    for (const { id, state, organizationId, contractId } of owned) {
      try {
        await this.events.transaction(async (tx) => {
          const now = new Date();
          const { recipients } = await this.routing.route({ organizationId, contractId }, now, tx);
          await this.lifecycle.apply(
            id,
            state,
            'NOTIFY_BACKUP',
            { kind: 'SYSTEM' },
            { code: 'OWNER_DEACTIVATED', at: now, recipients },
            tx,
          );
        });
        moved++;
      } catch (error) {
        if (lostRace(error)) continue;
        this.logger.error(
          `OWNER_DEACTIVATED on incident ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return moved;
  }
}
