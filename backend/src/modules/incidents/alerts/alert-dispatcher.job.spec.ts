import { EventEmitter2 } from '@nestjs/event-emitter';
import { AlertChannel, AlertKind, Prisma } from '@prisma/client';
import { AccountsService } from '../../auth';
import { DevicesService } from '../../devices';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ContractsService } from '../../rentals';
import { AlertDeliveriesRepository, DueAlert } from '../alert-deliveries.repository';
import {
  AlertDispatcherJob,
  EMAIL_BATCH,
  EMAIL_LEASE_MS,
  EMAIL_SEND_TIMEOUT_MS,
  INCIDENT_ALERT,
  IncidentAlertEvent,
  msg31,
  msg40,
} from './alert-dispatcher.job';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const CREATED = new Date('2026-10-29T03:15:00Z');
const LAST_SEEN = new Date('2026-10-29T03:02:00Z');

const due = (overrides: Partial<DueAlert> = {}): DueAlert => ({
  id: 'a-1',
  incidentId: 'inc-1',
  recipientId: 'u-p',
  channel: AlertChannel.WEBSOCKET,
  kind: AlertKind.TRANSITION,
  lastSeenAt: null,
  tier: 'PRIMARY',
  attempts: 0,
  code: 'INC-2026-000001',
  deviceId: 'dev-1',
  contractId: 'c-1',
  createdAt: CREATED,
  ...overrides,
});

describe('msg31', () => {
  it('formats MSG31 with the device, the holder and the ICT time', () => {
    expect(msg31('TL-0042', 'Le Thi E', CREATED)).toBe(
      'SOS: TL-0042 (Le Thi E), 10:15. Acknowledge now.',
    );
  });

  it('leaves the holder out when the device has no label', () => {
    expect(msg31('TL-0042', null, CREATED)).toBe('SOS: TL-0042, 10:15. Acknowledge now.');
  });
});

describe('msg40', () => {
  it('formats MSG40 with the device, the holder and the ICT time of the last reading', () => {
    expect(msg40('TL-0042', 'Le Thi E', LAST_SEEN)).toBe(
      'Device silent: TL-0042 (Le Thi E), last heard 10:02.',
    );
  });

  it('leaves the holder out when the device has no label', () => {
    expect(msg40('TL-0042', null, LAST_SEEN)).toBe('Device silent: TL-0042, last heard 10:02.');
  });
});

describe('AlertDispatcherJob (incidents 2.1)', () => {
  let alerts: {
    claimDue: jest.Mock;
    lease: jest.Mock;
    markSent: jest.Mock;
    markFailedAttempt: jest.Mock;
  };
  let devices: { assetTags: jest.Mock };
  let contracts: { holderLabels: jest.Mock };
  let emitter: { emit: jest.Mock };
  let job: AlertDispatcherJob;
  let accounts: { contactCard: jest.Mock };
  let mail: { send: jest.Mock };
  let events: { transaction: jest.Mock };
  // How many mocked transactions are open, to prove a send happens outside all of them.
  let openTransactions: number;

  beforeEach(() => {
    openTransactions = 0;
    alerts = {
      claimDue: jest.fn().mockResolvedValue([]),
      lease: jest.fn().mockResolvedValue(undefined),
      markSent: jest.fn().mockResolvedValue(undefined),
      markFailedAttempt: jest.fn().mockResolvedValue(undefined),
    };
    devices = { assetTags: jest.fn().mockResolvedValue(new Map([['dev-1', 'TL-0042']])) };
    contracts = {
      holderLabels: jest
        .fn()
        .mockResolvedValue(new Map([['c-1:dev-1', { name: 'Le Thi E', phone: null }]])),
    };
    emitter = { emit: jest.fn().mockReturnValue(true) };
    accounts = { contactCard: jest.fn().mockResolvedValue([{ email: 'primary@example.invalid' }]) };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    const parameters = {
      get: jest.fn((key: string) => Promise.resolve(key === 'incidents.alertMaxAttempts' ? 3 : 5)),
    };
    events = {
      transaction: jest.fn(async (work: (client: Prisma.TransactionClient) => unknown) => {
        openTransactions++;
        try {
          return await work(tx);
        } finally {
          openTransactions--;
        }
      }),
    };
    job = new AlertDispatcherJob(
      alerts as unknown as AlertDeliveriesRepository,
      devices as unknown as DevicesService,
      contracts as unknown as ContractsService,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
      emitter as unknown as EventEmitter2,
      accounts as unknown as AccountsService,
      mail,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('deliverAlerts: WEB and WEBSOCKET', () => {
    it('claims WEB and WEBSOCKET only, leaving EMAIL to its own lane and API_EVENT pending', async () => {
      await expect(job.deliverAlerts()).resolves.toBe(0);
      expect(alerts.claimDue).toHaveBeenCalledTimes(1);
      expect(alerts.claimDue).toHaveBeenCalledWith(
        [AlertChannel.WEB, AlertChannel.WEBSOCKET],
        expect.any(Date),
        100,
        tx,
      );
      expect(alerts.markSent).not.toHaveBeenCalled();
    });

    it('emits incident.alert to the recipient with MSG31 and marks WEB and WEBSOCKET rows sent', async () => {
      alerts.claimDue.mockResolvedValueOnce([due(), due({ id: 'a-2', channel: AlertChannel.WEB })]);
      await expect(job.deliverAlerts()).resolves.toBe(2);
      expect(emitter.emit).toHaveBeenCalledTimes(1);
      expect(emitter.emit).toHaveBeenCalledWith(INCIDENT_ALERT, {
        recipientId: 'u-p',
        alert: {
          incidentId: 'inc-1',
          kind: AlertKind.TRANSITION,
          code: 'INC-2026-000001',
          deviceLabel: 'TL-0042',
          holderName: 'Le Thi E',
          at: CREATED.toISOString(),
          message: 'SOS: TL-0042 (Le Thi E), 10:15. Acknowledge now.',
        },
      });
      expect(alerts.markSent).toHaveBeenCalledWith(['a-1', 'a-2'], expect.any(Date), tx);
      expect(contracts.holderLabels).toHaveBeenCalledWith([
        { contractId: 'c-1', deviceId: 'dev-1' },
      ]);
    });

    it('sends a STALE row as MSG40 at the last reading, beside an SOS row of the same incident', async () => {
      alerts.claimDue.mockResolvedValueOnce([
        due(),
        due({ id: 'a-2', recipientId: 'u-o', kind: AlertKind.STALE, lastSeenAt: LAST_SEEN }),
      ]);
      await expect(job.deliverAlerts()).resolves.toBe(2);
      expect(emitter.emit.mock.calls).toEqual([
        [INCIDENT_ALERT, expect.objectContaining({ recipientId: 'u-p' })],
        [
          INCIDENT_ALERT,
          {
            recipientId: 'u-o',
            alert: {
              incidentId: 'inc-1',
              kind: AlertKind.STALE,
              code: 'INC-2026-000001',
              deviceLabel: 'TL-0042',
              holderName: 'Le Thi E',
              at: LAST_SEEN.toISOString(),
              message: 'Device silent: TL-0042 (Le Thi E), last heard 10:02.',
            },
          },
        ],
      ]);
      const first = (emitter.emit.mock.calls[0] as [string, IncidentAlertEvent])[1];
      expect(first.alert.kind).toBe(AlertKind.TRANSITION);
      expect(first.alert.message).toMatch(/^SOS: /);
      // Labels are read once per incident, whatever the number of rows.
      expect(devices.assetTags).toHaveBeenCalledWith(['dev-1']);
    });

    it('falls back to the incident code and no holder for an unrouted incident', async () => {
      devices.assetTags.mockResolvedValue(new Map());
      alerts.claimDue.mockResolvedValueOnce([due({ contractId: null })]);
      await job.deliverAlerts();
      expect(contracts.holderLabels).toHaveBeenCalledWith([]);
      expect((emitter.emit.mock.calls[0] as unknown[])[1]).toMatchObject({
        alert: { deviceLabel: 'INC-2026-000001', holderName: null },
      });
    });

    it('backs off a failed send by base x 2^attempts and keeps the rest of the batch', async () => {
      emitter.emit.mockImplementationOnce(() => {
        throw new Error('listener down');
      });
      alerts.claimDue.mockResolvedValueOnce([due(), due({ id: 'a-2', channel: AlertChannel.WEB })]);
      await expect(job.deliverAlerts()).resolves.toBe(1);
      const [id, error, retryAt] = alerts.markFailedAttempt.mock.calls[0] as [string, string, Date];
      expect([id, error]).toEqual(['a-1', 'listener down']);
      const claimedAt = (alerts.claimDue.mock.calls[0] as [unknown, Date])[1];
      expect(retryAt.getTime() - claimedAt.getTime()).toBe(5 * 1000 * 2);
      expect(alerts.markSent).toHaveBeenCalledWith(['a-2'], expect.any(Date), tx);
    });

    it('marks a row FAILED at the attempt limit (AC-07)', async () => {
      emitter.emit.mockImplementation(() => {
        throw new Error('gone');
      });
      alerts.claimDue.mockResolvedValueOnce([due({ attempts: 2 })]);
      await job.deliverAlerts();
      expect(alerts.markFailedAttempt).toHaveBeenCalledWith('a-1', 'gone', null, tx);
    });

    it('fails a WEBSOCKET row without a recipient instead of emitting it', async () => {
      alerts.claimDue.mockResolvedValueOnce([due({ recipientId: null })]);
      await job.deliverAlerts();
      expect(emitter.emit).not.toHaveBeenCalled();
      expect((alerts.markFailedAttempt.mock.calls[0] as unknown[])[1]).toBe(
        'WEBSOCKET alert without a recipient',
      );
    });

    it('keeps claiming while a batch comes back full, and stops after a short one', async () => {
      const full = Array.from({ length: 100 }, (_, index) =>
        due({ id: `w-${index}`, channel: AlertChannel.WEB }),
      );
      alerts.claimDue
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([due({ id: 'tail' })])
        .mockResolvedValue([]);
      await expect(job.deliverAlerts()).resolves.toBe(101);
      expect(alerts.claimDue).toHaveBeenCalledTimes(2);
      expect(alerts.markSent).toHaveBeenLastCalledWith(['tail'], expect.any(Date), tx);
    });

    it('emits a WEBSOCKET alert while an email send of the same incident is still pending', async () => {
      let release!: () => void;
      mail.send.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
      alerts.claimDue.mockResolvedValueOnce([due({ id: 'mail', channel: AlertChannel.EMAIL })]);
      const emailing = job.deliverEmailAlerts();
      await waitFor(() => mail.send.mock.calls.length === 1);
      alerts.claimDue.mockResolvedValueOnce([due({ id: 'socket' })]);
      await expect(job.deliverAlerts()).resolves.toBe(1);
      expect(emitter.emit).toHaveBeenCalledTimes(1);
      expect(alerts.markSent).toHaveBeenCalledWith(['socket'], expect.any(Date), tx);
      release();
      await expect(emailing).resolves.toBe(1);
    });
  });

  describe('deliverEmailAlerts: EMAIL', () => {
    it('claims EMAIL only, leases the batch and commits before sending', async () => {
      alerts.claimDue.mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL })]);
      mail.send.mockImplementation(() => {
        expect(openTransactions).toBe(0);
        return Promise.resolve();
      });
      await expect(job.deliverEmailAlerts()).resolves.toBe(1);
      const [channels, claimedAt, limit] = alerts.claimDue.mock.calls[0] as [
        AlertChannel[],
        Date,
        number,
      ];
      expect([channels, limit]).toEqual([[AlertChannel.EMAIL], EMAIL_BATCH]);
      expect(alerts.lease).toHaveBeenCalledWith(
        ['a-1'],
        new Date(claimedAt.getTime() + EMAIL_LEASE_MS),
        tx,
      );
      expect(alerts.lease.mock.invocationCallOrder[0]).toBeLessThan(
        mail.send.mock.invocationCallOrder[0],
      );
      expect(EMAIL_LEASE_MS).toBeGreaterThan(EMAIL_SEND_TIMEOUT_MS);
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it('settles a send slower than the old 5 s transaction limit exactly once', async () => {
      jest.useFakeTimers();
      alerts.claimDue
        .mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL })])
        .mockResolvedValue([]);
      mail.send.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(() => resolve(), 6000)),
      );
      const run = job.deliverEmailAlerts();
      await jest.advanceTimersByTimeAsync(6000);
      await expect(run).resolves.toBe(1);
      expect(alerts.markSent).toHaveBeenCalledTimes(1);
      expect(alerts.markSent).toHaveBeenCalledWith(['a-1'], expect.any(Date), tx);
      expect(alerts.markFailedAttempt).not.toHaveBeenCalled();
      // The claim and the settlement are separate transactions; neither spans the send.
      expect(events.transaction).toHaveBeenCalledTimes(2);
      await expect(job.deliverEmailAlerts()).resolves.toBe(0);
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(alerts.markSent).toHaveBeenCalledTimes(1);
    });

    it('bounds a hanging send by the send timeout and backs it off', async () => {
      jest.useFakeTimers();
      alerts.claimDue.mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL })]);
      mail.send.mockReturnValue(new Promise<void>(() => undefined));
      const run = job.deliverEmailAlerts();
      await jest.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
      await expect(run).resolves.toBe(0);
      expect(alerts.markFailedAttempt).toHaveBeenCalledWith(
        'a-1',
        `SMTP send timed out after ${EMAIL_SEND_TIMEOUT_MS} ms`,
        expect.any(Date),
        tx,
      );
    });

    it('grows attempts on each failed send until the FAILED cap, then sends no more', async () => {
      // A stateful outbox row, as the repository would hold it.
      const row = { status: 'PENDING', attempts: 0, lastError: null as string | null };
      alerts.claimDue.mockImplementation(() =>
        Promise.resolve(
          row.status === 'PENDING'
            ? [due({ channel: AlertChannel.EMAIL, attempts: row.attempts })]
            : [],
        ),
      );
      alerts.markFailedAttempt.mockImplementation(
        (_id: string, error: string, retryAt: Date | null) => {
          row.attempts++;
          row.lastError = error;
          if (!retryAt) row.status = 'FAILED';
          return Promise.resolve();
        },
      );
      mail.send.mockRejectedValue(new Error('SMTP unavailable'));
      for (let run = 1; run <= 3; run++) {
        await expect(job.deliverEmailAlerts()).resolves.toBe(0);
        expect(row.attempts).toBe(run);
      }
      expect(row).toEqual({ status: 'FAILED', attempts: 3, lastError: 'SMTP unavailable' });
      expect(
        alerts.markFailedAttempt.mock.calls.map((call: unknown[]) => call[2] === null),
      ).toEqual([false, false, true]);
      await expect(job.deliverEmailAlerts()).resolves.toBe(0);
      expect(mail.send).toHaveBeenCalledTimes(3);
    });

    it('emails only the account named by each outbox row, with no other recipient', async () => {
      accounts.contactCard.mockImplementation((ids: string[]) =>
        Promise.resolve([{ email: `${ids[0]}@example.invalid` }]),
      );
      alerts.claimDue.mockResolvedValueOnce([
        due({ channel: AlertChannel.EMAIL }),
        due({ id: 'a-2', channel: AlertChannel.EMAIL, recipientId: 'u-other' }),
      ]);
      await expect(job.deliverEmailAlerts()).resolves.toBe(2);
      expect(accounts.contactCard.mock.calls).toEqual([[['u-p']], [['u-other']]]);
      expect(mail.send.mock.calls.map(([message]: [{ to: string }]) => message.to)).toEqual([
        'u-p@example.invalid',
        'u-other@example.invalid',
      ]);
      expect(mail.send).toHaveBeenCalledWith({
        to: 'u-p@example.invalid',
        subject: 'TrekLink alert: INC-2026-000001',
        text: 'SOS: TL-0042 (Le Thi E), 10:15. Acknowledge now.\nIncident: INC-2026-000001',
      });
      expect(alerts.markSent.mock.calls).toEqual([
        [['a-1'], expect.any(Date), tx],
        [['a-2'], expect.any(Date), tx],
      ]);
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it.each([0, 1])('backs off EMAIL attempt %i from its settlement time', async (attempts) => {
      mail.send.mockRejectedValue(new Error('SMTP unavailable'));
      alerts.claimDue.mockResolvedValueOnce([
        due({ channel: AlertChannel.EMAIL, attempts }),
        due({ id: 'ok', channel: AlertChannel.EMAIL }),
      ]);
      mail.send
        .mockRejectedValueOnce(new Error('SMTP unavailable'))
        .mockResolvedValueOnce(undefined);
      const started = Date.now();
      await expect(job.deliverEmailAlerts()).resolves.toBe(1);
      const [id, error, retryAt] = alerts.markFailedAttempt.mock.calls[0] as [string, string, Date];
      expect([id, error]).toEqual(['a-1', 'SMTP unavailable']);
      expect(retryAt.getTime()).toBeGreaterThanOrEqual(started + 5000 * 2 ** (attempts + 1));
      expect(retryAt.getTime()).toBeLessThanOrEqual(Date.now() + 5000 * 2 ** (attempts + 1));
      expect(alerts.markSent).toHaveBeenCalledWith(['ok'], expect.any(Date), tx);
    });

    it('settles EMAIL as terminal failure at the configured attempt limit', async () => {
      mail.send.mockRejectedValue('SMTP unavailable');
      alerts.claimDue.mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL, attempts: 2 })]);
      await expect(job.deliverEmailAlerts()).resolves.toBe(0);
      expect(alerts.markFailedAttempt).toHaveBeenCalledWith('a-1', 'SMTP unavailable', null, tx);
    });

    it.each([
      {
        recipientId: null,
        cards: [{ email: 'primary@example.invalid' }],
        error: 'EMAIL alert without a recipient',
      },
      { recipientId: 'deleted', cards: [], error: 'EMAIL alert recipient unavailable' },
      {
        recipientId: 'missing-email',
        cards: [{ email: '' }],
        error: 'EMAIL alert recipient unavailable',
      },
    ])('retries an undeliverable EMAIL: $error', async ({ recipientId, cards, error }) => {
      accounts.contactCard.mockResolvedValue(cards);
      alerts.claimDue.mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL, recipientId })]);
      await job.deliverEmailAlerts();
      expect(mail.send).not.toHaveBeenCalled();
      expect(alerts.markFailedAttempt).toHaveBeenCalledWith('a-1', error, expect.any(Date), tx);
    });

    it('retries a failed account read', async () => {
      accounts.contactCard.mockRejectedValue(new Error('directory unavailable'));
      alerts.claimDue.mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL })]);
      await expect(job.deliverEmailAlerts()).resolves.toBe(0);
      expect(alerts.markFailedAttempt).toHaveBeenCalledWith(
        'a-1',
        'directory unavailable',
        expect.any(Date),
        tx,
      );
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('repeats an accepted email if its settlement rolls back (at least once)', async () => {
      alerts.claimDue
        .mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL })])
        .mockResolvedValueOnce([due({ channel: AlertChannel.EMAIL })])
        .mockResolvedValue([]);
      alerts.markSent.mockRejectedValueOnce(new Error('settlement rolled back'));
      await expect(job.deliverEmailAlerts()).rejects.toThrow('settlement rolled back');
      await expect(job.deliverEmailAlerts()).resolves.toBe(1);
      expect(mail.send).toHaveBeenCalledTimes(2);
      expect(alerts.markFailedAttempt).not.toHaveBeenCalled();
    });

    it('keeps claiming while an email batch comes back full', async () => {
      const full = Array.from({ length: EMAIL_BATCH }, (_, index) =>
        due({ id: `m-${index}`, channel: AlertChannel.EMAIL }),
      );
      alerts.claimDue.mockResolvedValueOnce(full).mockResolvedValue([]);
      await expect(job.deliverEmailAlerts()).resolves.toBe(EMAIL_BATCH);
      expect(alerts.claimDue).toHaveBeenCalledTimes(2);
    });
  });

  describe('wake on incident.alertsQueued', () => {
    it('starts both lanes at once', async () => {
      job.wake();
      await waitFor(() => alerts.claimDue.mock.calls.length === 2);
      expect(alerts.claimDue.mock.calls.map((call: unknown[]) => call[0])).toEqual(
        expect.arrayContaining([[AlertChannel.WEB, AlertChannel.WEBSOCKET], [AlertChannel.EMAIL]]),
      );
    });

    it('turns a wake during a run into one more pass, never an overlapping run', async () => {
      let releaseFirst!: (rows: DueAlert[]) => void;
      let liveClaims = 0;
      let active = 0;
      let maxActive = 0;
      alerts.claimDue.mockImplementation(async (channels: AlertChannel[]) => {
        if (channels.includes(AlertChannel.EMAIL)) return [];
        liveClaims++;
        active++;
        maxActive = Math.max(maxActive, active);
        const rows =
          liveClaims === 1
            ? await new Promise<DueAlert[]>((resolve) => (releaseFirst = resolve))
            : [due({ id: 'woken' })];
        active--;
        return rows;
      });
      const first = job.deliverAlerts();
      await waitFor(() => liveClaims === 1);
      // A cron tick and two wakes arrive while the first claim is in flight.
      const second = job.deliverAlerts();
      job.wake();
      job.wake();
      expect(liveClaims).toBe(1);
      releaseFirst([due({ id: 'first' })]);
      await expect(first).resolves.toBe(2);
      await expect(second).resolves.toBe(2);
      expect(liveClaims).toBe(2);
      expect(maxActive).toBe(1);
      expect(emitter.emit).toHaveBeenCalledTimes(2);
    });

    it('logs a failed woken run instead of rejecting, and the next run starts fresh', async () => {
      alerts.claimDue.mockRejectedValueOnce(new Error('database down')).mockResolvedValue([]);
      const logged = jest
        .spyOn((job as unknown as { logger: { error: () => void } }).logger, 'error')
        .mockImplementation(() => undefined);
      job.wake();
      await waitFor(() => logged.mock.calls.length === 1);
      expect(String((logged.mock.calls[0] as unknown[])[0])).toContain('database down');
      await expect(job.deliverAlerts()).resolves.toBe(0);
    });
  });
});

// Lets pending promise callbacks run until the condition holds (real timers only).
async function waitFor(condition: () => boolean): Promise<void> {
  for (let tick = 0; tick < 50 && !condition(); tick++) await new Promise(setImmediate);
  expect(condition()).toBe(true);
}

describe('AlertDeliveriesRepository outbox settlement', () => {
  const repository = new AlertDeliveriesRepository();

  it('claims with SKIP LOCKED through a raw query', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([due()]);
    const client = { $queryRaw } as unknown as Prisma.TransactionClient;
    await expect(
      repository.claimDue([AlertChannel.WEB], new Date(), 10, client),
    ).resolves.toHaveLength(1);
    const sql = (($queryRaw.mock.calls[0] as unknown[])[0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FOR UPDATE OF a SKIP LOCKED');
  });

  it('marks rows sent, and skips an empty batch', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const client = { alertDelivery: { updateMany } } as unknown as Prisma.TransactionClient;
    await repository.markSent([], new Date(), client);
    expect(updateMany).not.toHaveBeenCalled();
    const at = new Date();
    await repository.markSent(['a-1'], at, client);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a-1'] } },
      data: { status: 'SENT', sentAt: at, attempts: { increment: 1 } },
    });
  });

  it('leases claimed rows by moving their due time, and skips an empty batch', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const client = { alertDelivery: { updateMany } } as unknown as Prisma.TransactionClient;
    const until = new Date();
    await repository.lease([], until, client);
    expect(updateMany).not.toHaveBeenCalled();
    await repository.lease(['a-1'], until, client);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a-1'] } },
      data: { nextAttemptAt: until },
    });
  });

  it('reschedules a failed attempt, or marks it FAILED without a retry time', async () => {
    const update = jest.fn().mockResolvedValue({});
    const client = { alertDelivery: { update } } as unknown as Prisma.TransactionClient;
    const retry = new Date();
    await repository.markFailedAttempt('a-1', 'boom', retry, client);
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'a-1' },
      data: { attempts: { increment: 1 }, lastError: 'boom', nextAttemptAt: retry },
    });
    await repository.markFailedAttempt('a-1', 'boom', null, client);
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'a-1' },
      data: { attempts: { increment: 1 }, lastError: 'boom', status: 'FAILED' },
    });
  });
});
