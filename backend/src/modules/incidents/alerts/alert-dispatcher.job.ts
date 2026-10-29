import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AlertChannel } from '@prisma/client';
import { DevicesService } from '../../devices';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { ContractsService } from '../../rentals';
import { AlertDeliveriesRepository, DueAlert } from '../alert-deliveries.repository';

export const INCIDENT_ALERT = 'incident.alert';

// The WebSocket payload of ws-live-contract, addressed to one account's room.
export interface IncidentAlertEvent {
  recipientId: string;
  alert: {
    incidentId: string;
    code: string;
    deviceLabel: string;
    holderName: string | null;
    at: string;
    message: string;
  };
}

// Channels with a sender in this build (MF-03 session, ruling 3). EMAIL and API_EVENT rows stay
// PENDING until their senders land.
const CHANNELS: readonly AlertChannel[] = [AlertChannel.WEB, AlertChannel.WEBSOCKET];
const BATCH = 100;

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// MSG31: SOS: {device} ({holder}), {time}. Acknowledge now.
export const msg31 = (device: string, holder: string | null, at: Date): string =>
  `SOS: ${device}${holder ? ` (${holder})` : ''}, ${clock.format(at)}. Acknowledge now.`;

// Task 2.1 (design §3, D-034 rule 3). Rows are claimed with SKIP LOCKED and settled in the same
// transaction. WEB is sent once the row exists: the queue page reads it. WEBSOCKET emits
// `incident.alert`, whose synchronous listener in monitoring publishes to `user:<id>`; returning
// means sent. A failure backs off `alertRetryBaseSeconds x 2^attempts`, then FAILED at
// `alertMaxAttempts`. Delivery never blocks a transition: it runs after the transition committed.
@Injectable()
export class AlertDispatcherJob {
  private readonly logger = new Logger(AlertDispatcherJob.name);

  constructor(
    private readonly alerts: AlertDeliveriesRepository,
    private readonly devices: DevicesService,
    private readonly contracts: ContractsService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly emitter: EventEmitter2,
  ) {}

  @ScheduledJob('incidents.deliverAlerts', '*/2 * * * * *')
  async deliverAlerts(): Promise<number> {
    return this.events.transaction(async (tx) => {
      const now = new Date();
      const due = await this.alerts.claimDue(CHANNELS, now, BATCH, tx);
      if (due.length === 0) return 0;
      const [baseSeconds, maxAttempts] = await Promise.all([
        this.parameters.get('incidents.alertRetryBaseSeconds', tx),
        this.parameters.get('incidents.alertMaxAttempts', tx),
      ]);
      const payloads = await this.payloads(due);
      const sent: string[] = [];
      for (const row of due) {
        try {
          if (row.channel === AlertChannel.WEBSOCKET) {
            if (!row.recipientId) throw new Error('WEBSOCKET alert without a recipient');
            this.emitter.emit(INCIDENT_ALERT, {
              recipientId: row.recipientId,
              alert: payloads.get(row.incidentId)!,
            } satisfies IncidentAlertEvent);
          }
          sent.push(row.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const attempts = row.attempts + 1;
          const retryAt =
            attempts >= maxAttempts
              ? null
              : new Date(now.getTime() + baseSeconds * 1000 * 2 ** attempts);
          if (!retryAt)
            this.logger.error(`Alert ${row.id} FAILED after ${attempts} attempts: ${message}`);
          await this.alerts.markFailedAttempt(row.id, message, retryAt, tx);
        }
      }
      await this.alerts.markSent(sent, now, tx);
      return sent.length;
    });
  }

  // One alert body per incident: asset tag, holder label and MSG31 at the alert's creation time.
  private async payloads(due: DueAlert[]): Promise<Map<string, IncidentAlertEvent['alert']>> {
    const incidents = new Map(due.map((row) => [row.incidentId, row]));
    const rows = [...incidents.values()];
    const [tags, holders] = await Promise.all([
      this.devices.assetTags(rows.map((row) => row.deviceId)),
      this.contracts.holderLabels(
        rows
          .filter((row) => row.contractId !== null)
          .map((row) => ({ contractId: row.contractId!, deviceId: row.deviceId })),
      ),
    ]);
    const bodies = new Map<string, IncidentAlertEvent['alert']>();
    for (const row of rows) {
      const deviceLabel = tags.get(row.deviceId) ?? row.code;
      const holderName = holders.get(`${row.contractId}:${row.deviceId}`)?.name ?? null;
      bodies.set(row.incidentId, {
        incidentId: row.incidentId,
        code: row.code,
        deviceLabel,
        holderName,
        at: row.createdAt.toISOString(),
        message: msg31(deviceLabel, holderName, row.createdAt),
      });
    }
    return bodies;
  }
}
