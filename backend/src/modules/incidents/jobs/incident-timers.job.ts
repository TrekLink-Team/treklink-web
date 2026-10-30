import { Injectable, Logger } from '@nestjs/common';
import { IncidentState } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { IncidentLifecycle, IncidentTransitionReason } from '../incident-lifecycle';
import { DueTimer, IncidentsRepository } from '../incidents.repository';
import { RoutingService } from '../routing.service';

// The states a timer moves on; each has one target in NEXT.
type TimedState = Extract<
  IncidentState,
  | 'NOTIFY_PRIMARY'
  | 'NOTIFY_BACKUP'
  | 'NOTIFY_MANAGER'
  | 'ACKNOWLEDGED'
  | 'RESPONDING'
  | 'RESOLVED'
  | 'FALSE_ALARM'
>;

interface Timer {
  states: TimedState[];
  column: DueTimer;
  code: Extract<
    IncidentTransitionReason['code'],
    'TIER_TIMEOUT' | 'STALE_LIMIT' | 'REOPEN_WINDOW_ENDED'
  >;
  // A close alerts nobody but the organization's stream; the other two alert the tiers.
  alerts: boolean;
}

const TIER_TIMEOUTS: Timer = {
  states: ['NOTIFY_PRIMARY', 'NOTIFY_BACKUP', 'NOTIFY_MANAGER'],
  column: 'tierDeadlineAt',
  code: 'TIER_TIMEOUT',
  alerts: true,
};
const STALE_RESPONSES: Timer = {
  states: ['ACKNOWLEDGED', 'RESPONDING'],
  column: 'statusDueAt',
  code: 'STALE_LIMIT',
  alerts: true,
};
const CLOSE_AFTER_REOPEN_WINDOW: Timer = {
  states: ['RESOLVED', 'FALSE_ALARM'],
  column: 'reopenWindowEndsAt',
  code: 'REOPEN_WINDOW_ENDED',
  alerts: false,
};

// The target of each timed state; the states of the three timers do not overlap. A complete Record,
// so the compiler rejects a timer state without a target (PR #120 review).
const NEXT: Record<Timer['states'][number], IncidentState> = {
  NOTIFY_PRIMARY: 'NOTIFY_BACKUP',
  NOTIFY_BACKUP: 'NOTIFY_MANAGER',
  NOTIFY_MANAGER: 'ESCALATED',
  ACKNOWLEDGED: 'ESCALATED',
  RESPONDING: 'ESCALATED',
  RESOLVED: 'CLOSED',
  FALSE_ALARM: 'CLOSED',
};

// Rows per tick; the rest are due on the next tick.
export const TIMER_BATCH = 100;

// A human action or an SOS moved the incident after it was read: the job lost the race cleanly.
const lostRace = (error: unknown): boolean =>
  error instanceof DomainException &&
  (error.errorCode === ErrorCode.STALE_VERSION ||
    error.errorCode === ErrorCode.INVALID_STATE_TRANSITION);

// Task 3.1 (design §6, REQ-EVT-04, REQ-EVT-07, REQ-EVT-10, REQ-ERR-04). Each job reads the incidents
// whose deadline column has passed, then applies one transition per incident in its own transaction
// with the expected state, as SYSTEM. The lifecycle's guards re-check the deadline under the row lock,
// so a raced acknowledgement, status update or reopen wins and the job skips that incident. Deadlines
// live in the database, so after a restart each fires once from its stored time. ESCALATED alerts the
// organization's Managers and the active TrekLink Staff (D-079) through RoutingService.recipientsOf.
@Injectable()
export class IncidentTimersJob {
  private readonly logger = new Logger(IncidentTimersJob.name);

  constructor(
    private readonly incidents: IncidentsRepository,
    private readonly lifecycle: IncidentLifecycle,
    private readonly routing: RoutingService,
    private readonly events: TransactionalEvents,
  ) {}

  // REQ-EVT-04: the next non-empty tier, or ESCALATED after the Manager tier.
  @ScheduledJob('incidents.tierTimeouts', '*/5 * * * * *')
  tierTimeouts(): Promise<number> {
    return this.advance(TIER_TIMEOUTS);
  }

  // REQ-EVT-07: an owned incident with no status update in time goes to ESCALATED, owner kept.
  @ScheduledJob('incidents.staleResponses', '*/30 * * * * *')
  staleResponses(): Promise<number> {
    return this.advance(STALE_RESPONSES);
  }

  // REQ-EVT-10: RESOLVED or FALSE_ALARM past its reopen window goes to CLOSED. A window never set
  // has not ended (leader ruling on PR #114), so such a row is not selected.
  @ScheduledJob('incidents.closeAfterReopenWindow', '0 * * * * *')
  closeAfterReopenWindow(): Promise<number> {
    return this.advance(CLOSE_AFTER_REOPEN_WINDOW);
  }

  private async advance(timer: Timer): Promise<number> {
    const now = new Date();
    const due = await this.incidents.dueTimers(timer.states, timer.column, now, TIMER_BATCH);
    let moved = 0;
    for (const { id, state, organizationId } of due) {
      try {
        await this.events.transaction(async (tx) => {
          const recipients = await this.routing.recipientsOf(
            timer.alerts ? organizationId : null,
            now,
            tx,
          );
          await this.lifecycle.apply(
            id,
            state,
            NEXT[state],
            { kind: 'SYSTEM' },
            { code: timer.code, at: now, recipients },
            tx,
          );
        });
        moved++;
      } catch (error) {
        if (lostRace(error)) continue;
        // One failing incident must not hold back the others; it is due again on the next tick.
        this.logger.error(
          `${timer.code} on incident ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return moved;
  }
}
