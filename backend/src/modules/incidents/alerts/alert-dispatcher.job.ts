import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AlertChannel, AlertKind, Prisma } from '@prisma/client';
import { AccountsService, MAIL_PORT, MailPort } from '../../auth';
import { DevicesService } from '../../devices';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { ContractsService } from '../../rentals';
import { AlertDeliveriesRepository, DueAlert } from '../alert-deliveries.repository';
import { clockTime } from '../display-time';
import { INCIDENT_ALERTS_QUEUED } from './alert-events';

export const INCIDENT_ALERT = 'incident.alert';

// The WebSocket payload of ws-live-contract, addressed to one account's room.
export interface IncidentAlertEvent {
  recipientId: string;
  alert: {
    incidentId: string;
    // TRANSITION: an SOS alert to acknowledge (MSG31). STALE: the device went silent (MSG40), with
    // `at` its last reading; the client shows it without Acknowledge.
    kind: AlertKind;
    code: string;
    deviceLabel: string;
    holderName: string | null;
    at: string;
    message: string;
  };
}

// API_EVENT stays PENDING until its sender lands. EMAIL reuses auth's configured MailPort.
const LIVE_CHANNELS: readonly AlertChannel[] = [AlertChannel.WEB, AlertChannel.WEBSOCKET];
const EMAIL_CHANNELS: readonly AlertChannel[] = [AlertChannel.EMAIL];
const BATCH = 100;
// Emails of one batch are sent concurrently, so this also bounds the open SMTP connections.
export const EMAIL_BATCH = 10;
// TODO(params): no ParameterService key bounds an SMTP send yet. Move this to a catalog parameter
// (a new forward migration plus `scripts/specs/catalog.py`) when one is agreed.
export const EMAIL_SEND_TIMEOUT_MS = 10_000;
// A claimed EMAIL row is leased for this long: its `nextAttemptAt` moves forward when the claim
// commits, so another run or replica skips it while the send is in flight. It covers the send bound
// plus settlement; if the process dies mid-send, the row is due again once the lease ends.
export const EMAIL_LEASE_MS = 2 * EMAIL_SEND_TIMEOUT_MS;

interface PassResult {
  claimed: number;
  sent: number;
}

// Runs one delivery lane at most once at a time in this process. A request while a run is in
// progress starts nothing; it schedules exactly one more pass when the current one ends, so a wake
// that arrives mid-claim is never lost.
class SerialRunner {
  private running: Promise<number> | null = null;
  private again = false;

  constructor(private readonly pass: () => Promise<number>) {}

  run(): Promise<number> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async loop(): Promise<number> {
    let total = 0;
    do {
      this.again = false;
      total += await this.pass();
    } while (this.again);
    return total;
  }
}

// MSG31: SOS: {device} ({holder}), {time}. Acknowledge now.
export const msg31 = (device: string, holder: string | null, at: Date): string =>
  `SOS: ${device}${holder ? ` (${holder})` : ''}, ${clockTime(at)}. Acknowledge now.`;

// MSG40: Device silent: {device} ({holder}), last heard {time}.
export const msg40 = (device: string, holder: string | null, lastSeenAt: Date): string =>
  `Device silent: ${device}${holder ? ` (${holder})` : ''}, last heard ${clockTime(lastSeenAt)}.`;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`SMTP send timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
};

// Task 2.1 (design §3, D-034 rule 3). Two lanes, each a scheduled job and each woken after commit
// by `incident.alertsQueued`; each keeps claiming while a batch comes back full, and the 2 s cron
// is the retry backstop.
// - WEB and WEBSOCKET: claimed with SKIP LOCKED, delivered and settled in one short transaction.
//   WEB is sent once the row exists: the queue page reads it. WEBSOCKET emits `incident.alert`,
//   whose synchronous listener in monitoring publishes to `user:<id>`; returning means sent.
// - EMAIL: claimed and leased in a short transaction that commits before any send. Each send is
//   bounded by EMAIL_SEND_TIMEOUT_MS and runs outside any transaction, then its row settles in its
//   own short transaction. An email never holds a database transaction or the WEB and WEBSOCKET
//   lane.
// A failure backs off `alertRetryBaseSeconds x 2^attempts`, then FAILED at `alertMaxAttempts`.
// Delivery never blocks a transition: it runs after the transition committed.
// Delivery is at least once. A WEBSOCKET alert is emitted before `markSent` commits, so if that
// commit fails the row is claimed again and the recipient sees the alert twice; the client keys the
// banner by incident id, so a repeat replaces the shown alert (AlertBanner). An email accepted by
// SMTP is sent again if its settlement fails, or if the send outlives its timeout and still lands.
@Injectable()
export class AlertDispatcherJob {
  private readonly logger = new Logger(AlertDispatcherJob.name);
  private readonly live = new SerialRunner(() => this.drain(() => this.livePass(), BATCH));
  private readonly email = new SerialRunner(() => this.drain(() => this.emailPass(), EMAIL_BATCH));

  constructor(
    private readonly alerts: AlertDeliveriesRepository,
    private readonly devices: DevicesService,
    private readonly contracts: ContractsService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly emitter: EventEmitter2,
    private readonly accounts: AccountsService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  // WEB and WEBSOCKET rows. Resolves with the number of rows sent.
  @ScheduledJob('incidents.deliverAlerts', '*/2 * * * * *')
  deliverAlerts(): Promise<number> {
    return this.live.run();
  }

  // EMAIL rows. Resolves with the number of rows sent.
  @ScheduledJob('incidents.deliverEmailAlerts', '*/2 * * * * *')
  deliverEmailAlerts(): Promise<number> {
    return this.email.run();
  }

  // Starts both lanes without waiting, so the emitting transaction's caller is not delayed.
  @OnEvent(INCIDENT_ALERTS_QUEUED)
  wake(): void {
    this.deliverAlerts().catch((error: unknown) => this.logFailedWake('WEB and WEBSOCKET', error));
    this.deliverEmailAlerts().catch((error: unknown) => this.logFailedWake('EMAIL', error));
  }

  private logFailedWake(lane: string, error: unknown): void {
    this.logger.error(
      `Woken ${lane} delivery failed, the cron retries it: ${error instanceof Error ? error.stack : String(error)}`,
    );
  }

  // A full batch may leave more due rows behind, so claim again until a batch comes back short.
  private async drain(pass: () => Promise<PassResult>, limit: number): Promise<number> {
    let sent = 0;
    let result: PassResult;
    do {
      result = await pass();
      sent += result.sent;
    } while (result.claimed >= limit);
    return sent;
  }

  private async livePass(): Promise<PassResult> {
    return this.events.transaction(async (tx) => {
      const now = new Date();
      const due = await this.alerts.claimDue(LIVE_CHANNELS, now, BATCH, tx);
      if (due.length === 0) return { claimed: 0, sent: 0 };
      const [baseSeconds, maxAttempts] = await this.retryPolicy(tx);
      const payloads = await this.payloads(due);
      const sent: string[] = [];
      for (const row of due) {
        try {
          if (row.channel === AlertChannel.WEBSOCKET) {
            if (!row.recipientId) throw new Error('WEBSOCKET alert without a recipient');
            this.emitter.emit(INCIDENT_ALERT, {
              recipientId: row.recipientId,
              alert: payloads.get(row.id)!,
            } satisfies IncidentAlertEvent);
          }
          sent.push(row.id);
        } catch (error) {
          await this.markFailed(row, error, now, baseSeconds, maxAttempts, tx);
        }
      }
      await this.alerts.markSent(sent, now, tx);
      return { claimed: due.length, sent: sent.length };
    });
  }

  private async emailPass(): Promise<PassResult> {
    const due = await this.events.transaction(async (tx) => {
      const now = new Date();
      const rows = await this.alerts.claimDue(EMAIL_CHANNELS, now, EMAIL_BATCH, tx);
      await this.alerts.lease(
        rows.map((row) => row.id),
        new Date(now.getTime() + EMAIL_LEASE_MS),
        tx,
      );
      return rows;
    });
    if (due.length === 0) return { claimed: 0, sent: 0 };
    const [baseSeconds, maxAttempts] = await this.retryPolicy();
    const payloads = await this.payloads(due);
    const outcomes = await Promise.allSettled(
      due.map((row) => this.sendEmail(row, payloads.get(row.id)!, baseSeconds, maxAttempts)),
    );
    const unsettled = outcomes.find((outcome) => outcome.status === 'rejected');
    if (unsettled) throw unsettled.reason;
    const sent = outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value);
    return { claimed: due.length, sent: sent.length };
  }

  // Sends one EMAIL row outside any transaction, then settles it in its own. Resolves true when
  // the transport accepted the message.
  private async sendEmail(
    row: DueAlert,
    alert: IncidentAlertEvent['alert'],
    baseSeconds: number,
    maxAttempts: number,
  ): Promise<boolean> {
    let failure: { error: unknown } | null = null;
    try {
      if (!row.recipientId) throw new Error('EMAIL alert without a recipient');
      const [recipient] = await this.accounts.contactCard([row.recipientId]);
      if (!recipient?.email) throw new Error('EMAIL alert recipient unavailable');
      await withTimeout(
        this.mail.send({
          to: recipient.email,
          subject: `TrekLink alert: ${alert.code}`,
          text: `${alert.message}\nIncident: ${alert.code}`,
        }),
        EMAIL_SEND_TIMEOUT_MS,
      );
    } catch (error) {
      failure = { error };
    }
    await this.events.transaction(async (tx) => {
      const settledAt = new Date();
      if (failure)
        await this.markFailed(row, failure.error, settledAt, baseSeconds, maxAttempts, tx);
      else await this.alerts.markSent([row.id], settledAt, tx);
    });
    return failure === null;
  }

  private retryPolicy(tx?: Prisma.TransactionClient): Promise<[number, number]> {
    return Promise.all([
      this.parameters.get('incidents.alertRetryBaseSeconds', tx),
      this.parameters.get('incidents.alertMaxAttempts', tx),
    ]);
  }

  private async markFailed(
    row: DueAlert,
    error: unknown,
    now: Date,
    baseSeconds: number,
    maxAttempts: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const message = errorText(error);
    const attempts = row.attempts + 1;
    const retryAt =
      attempts >= maxAttempts ? null : new Date(now.getTime() + baseSeconds * 1000 * 2 ** attempts);
    if (!retryAt)
      this.logger.error(`Alert ${row.id} FAILED after ${attempts} attempts: ${message}`);
    await this.alerts.markFailedAttempt(row.id, message, retryAt, tx);
  }

  // One alert body per row, keyed by row id: asset tag and holder label read once per incident, then
  // MSG31 at the alert's creation time for a TRANSITION row, or MSG40 at the device's last reading for
  // a STALE row.
  private async payloads(due: DueAlert[]): Promise<Map<string, IncidentAlertEvent['alert']>> {
    const incidents = [...new Map(due.map((row) => [row.incidentId, row])).values()];
    const [tags, holders] = await Promise.all([
      this.devices.assetTags(incidents.map((row) => row.deviceId)),
      this.contracts.holderLabels(
        incidents
          .filter((row) => row.contractId !== null)
          .map((row) => ({ contractId: row.contractId!, deviceId: row.deviceId })),
      ),
    ]);
    const bodies = new Map<string, IncidentAlertEvent['alert']>();
    for (const row of due) {
      const deviceLabel = tags.get(row.deviceId) ?? row.code;
      const holderName = holders.get(`${row.contractId}:${row.deviceId}`)?.name ?? null;
      const stale = row.kind === AlertKind.STALE;
      // The CHECK constraint gives every STALE row its reading; the fallback only keeps types honest.
      const at = stale ? (row.lastSeenAt ?? row.createdAt) : row.createdAt;
      bodies.set(row.id, {
        incidentId: row.incidentId,
        kind: row.kind,
        code: row.code,
        deviceLabel,
        holderName,
        at: at.toISOString(),
        message: stale ? msg40(deviceLabel, holderName, at) : msg31(deviceLabel, holderName, at),
      });
    }
    return bodies;
  }
}
