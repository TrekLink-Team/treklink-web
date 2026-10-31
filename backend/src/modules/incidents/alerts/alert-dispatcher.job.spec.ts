import { EventEmitter2 } from '@nestjs/event-emitter';
import { AlertChannel, Prisma } from '@prisma/client';
import { AccountsService } from '../../auth';
import { DevicesService } from '../../devices';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ContractsService } from '../../rentals';
import { AlertDeliveriesRepository, DueAlert } from '../alert-deliveries.repository';
import { AlertDispatcherJob, INCIDENT_ALERT, msg31 } from './alert-dispatcher.job';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const CREATED = new Date('2026-10-29T03:15:00Z');

const due = (overrides: Partial<DueAlert> = {}): DueAlert => ({
  id: 'a-1',
  incidentId: 'inc-1',
  recipientId: 'u-p',
  channel: AlertChannel.WEBSOCKET,
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

describe('AlertDispatcherJob.deliverAlerts (incidents 2.1)', () => {
  let alerts: { claimDue: jest.Mock; markSent: jest.Mock; markFailedAttempt: jest.Mock };
  let devices: { assetTags: jest.Mock };
  let contracts: { holderLabels: jest.Mock };
  let emitter: { emit: jest.Mock };
  let job: AlertDispatcherJob;
  let accounts: { contactCard: jest.Mock };
  let mail: { send: jest.Mock };

  beforeEach(() => {
    alerts = {
      claimDue: jest.fn().mockResolvedValue([]),
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
    const events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
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

  it('claims WEB, WEBSOCKET and EMAIL, leaving API_EVENT pending', async () => {
    await expect(job.deliverAlerts()).resolves.toBe(0);
    expect(alerts.claimDue).toHaveBeenCalledWith(
      [AlertChannel.WEB, AlertChannel.WEBSOCKET, AlertChannel.EMAIL],
      expect.any(Date),
      100,
      tx,
    );
    expect(alerts.markSent).not.toHaveBeenCalled();
  });

  it('emits incident.alert to the recipient with MSG31 and marks WEB and WEBSOCKET rows sent', async () => {
    alerts.claimDue.mockResolvedValue([due(), due({ id: 'a-2', channel: AlertChannel.WEB })]);
    await expect(job.deliverAlerts()).resolves.toBe(2);
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith(INCIDENT_ALERT, {
      recipientId: 'u-p',
      alert: {
        incidentId: 'inc-1',
        code: 'INC-2026-000001',
        deviceLabel: 'TL-0042',
        holderName: 'Le Thi E',
        at: CREATED.toISOString(),
        message: 'SOS: TL-0042 (Le Thi E), 10:15. Acknowledge now.',
      },
    });
    expect(alerts.markSent).toHaveBeenCalledWith(['a-1', 'a-2'], expect.any(Date), tx);
    expect(contracts.holderLabels).toHaveBeenCalledWith([{ contractId: 'c-1', deviceId: 'dev-1' }]);
  });

  it('falls back to the incident code and no holder for an unrouted incident', async () => {
    devices.assetTags.mockResolvedValue(new Map());
    alerts.claimDue.mockResolvedValue([due({ contractId: null })]);
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
    alerts.claimDue.mockResolvedValue([due(), due({ id: 'a-2', channel: AlertChannel.WEB })]);
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
    alerts.claimDue.mockResolvedValue([due({ attempts: 2 })]);
    await job.deliverAlerts();
    expect(alerts.markFailedAttempt).toHaveBeenCalledWith('a-1', 'gone', null, tx);
  });

  it('fails a WEBSOCKET row without a recipient instead of emitting it', async () => {
    alerts.claimDue.mockResolvedValue([due({ recipientId: null })]);
    await job.deliverAlerts();
    expect(emitter.emit).not.toHaveBeenCalled();
    expect((alerts.markFailedAttempt.mock.calls[0] as unknown[])[1]).toBe(
      'WEBSOCKET alert without a recipient',
    );
  });

  it('emails only the account named by each outbox row, with no other recipient', async () => {
    accounts.contactCard.mockImplementation((ids: string[]) =>
      Promise.resolve([{ email: `${ids[0]}@example.invalid` }]),
    );
    alerts.claimDue.mockResolvedValue([
      due({ channel: AlertChannel.EMAIL }),
      due({ id: 'a-2', channel: AlertChannel.EMAIL, recipientId: 'u-other' }),
    ]);
    await expect(job.deliverAlerts()).resolves.toBe(2);
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
    expect(alerts.markSent).toHaveBeenCalledWith(['a-1', 'a-2'], expect.any(Date), tx);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    'backs off EMAIL attempt %i without blocking other channels',
    async (attempts) => {
      mail.send.mockRejectedValue(new Error('SMTP unavailable'));
      alerts.claimDue.mockResolvedValue([
        due({ channel: AlertChannel.EMAIL, attempts }),
        due({ id: 'web', channel: AlertChannel.WEB }),
        due({ id: 'socket' }),
      ]);
      await expect(job.deliverAlerts()).resolves.toBe(2);
      const claimedAt = (alerts.claimDue.mock.calls[0] as [unknown, Date])[1];
      expect(alerts.markFailedAttempt).toHaveBeenCalledWith(
        'a-1',
        'SMTP unavailable',
        new Date(claimedAt.getTime() + 5000 * 2 ** (attempts + 1)),
        tx,
      );
      expect(alerts.markSent).toHaveBeenCalledWith(['web', 'socket'], expect.any(Date), tx);
      expect(emitter.emit).toHaveBeenCalledTimes(1);
    },
  );

  it('settles EMAIL as terminal failure at the configured attempt limit', async () => {
    mail.send.mockRejectedValue('SMTP unavailable');
    alerts.claimDue.mockResolvedValue([due({ channel: AlertChannel.EMAIL, attempts: 2 })]);
    await expect(job.deliverAlerts()).resolves.toBe(0);
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
    alerts.claimDue.mockResolvedValue([due({ channel: AlertChannel.EMAIL, recipientId })]);
    await job.deliverAlerts();
    expect(mail.send).not.toHaveBeenCalled();
    expect(alerts.markFailedAttempt).toHaveBeenCalledWith('a-1', error, expect.any(Date), tx);
  });

  it('retries a failed account read without blocking the web inbox', async () => {
    accounts.contactCard.mockRejectedValue(new Error('directory unavailable'));
    alerts.claimDue.mockResolvedValue([
      due({ channel: AlertChannel.EMAIL }),
      due({ id: 'web', channel: AlertChannel.WEB }),
    ]);
    await expect(job.deliverAlerts()).resolves.toBe(1);
    expect(alerts.markFailedAttempt).toHaveBeenCalledWith(
      'a-1',
      'directory unavailable',
      expect.any(Date),
      tx,
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('repeats an accepted email if outbox settlement rolls back (at least once)', async () => {
    alerts.claimDue.mockResolvedValue([due({ channel: AlertChannel.EMAIL })]);
    alerts.markSent.mockRejectedValueOnce(new Error('settlement rolled back'));
    await expect(job.deliverAlerts()).rejects.toThrow('settlement rolled back');
    await expect(job.deliverAlerts()).resolves.toBe(1);
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(alerts.markFailedAttempt).not.toHaveBeenCalled();
  });
});

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
