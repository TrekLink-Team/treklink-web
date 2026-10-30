import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { IncidentLifecycle } from '../incident-lifecycle';
import { IncidentsRepository } from '../incidents.repository';
import { RoutingService } from '../routing.service';
import { OwnerDeactivationListener } from './owner-deactivation.listener';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const RECIPIENTS = { primary: ['p'], backup: ['b'], managers: ['m'], staff: ['s', 'a'] };

describe('OwnerDeactivationListener (incidents 4.2, REQ-EVT-11)', () => {
  let incidents: { ownedActive: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let routing: { recipientsOf: jest.Mock };
  let events: { transaction: jest.Mock };
  let listener: OwnerDeactivationListener;

  beforeEach(() => {
    incidents = {
      ownedActive: jest.fn().mockResolvedValue([
        { id: 'inc-1', state: 'ACKNOWLEDGED', organizationId: 'org-a' },
        { id: 'inc-2', state: 'RESPONDING', organizationId: 'org-b' },
      ]),
    };
    lifecycle = { apply: jest.fn().mockResolvedValue({}) };
    routing = { recipientsOf: jest.fn().mockResolvedValue(RECIPIENTS) };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
    };
    listener = new OwnerDeactivationListener(
      incidents as unknown as IncidentsRepository,
      lifecycle as unknown as IncidentLifecycle,
      routing as unknown as RoutingService,
      events as unknown as TransactionalEvents,
    );
  });

  it('returns each owned incident to NOTIFY_BACKUP as SYSTEM, one transaction each', async () => {
    await expect(listener.onMemberDeactivated({ userId: 'u-1' })).resolves.toBe(2);

    expect(incidents.ownedActive).toHaveBeenCalledWith('u-1');
    expect(events.transaction).toHaveBeenCalledTimes(2);
    // recipientsOf carries the Staff and Admin, so an all-empty cascade still alerts somebody.
    expect(routing.recipientsOf).toHaveBeenNthCalledWith(1, 'org-a', expect.any(Date), tx);
    expect(routing.recipientsOf).toHaveBeenNthCalledWith(2, 'org-b', expect.any(Date), tx);
    expect(lifecycle.apply).toHaveBeenNthCalledWith(
      1,
      'inc-1',
      'ACKNOWLEDGED',
      'NOTIFY_BACKUP',
      { kind: 'SYSTEM' },
      expect.objectContaining({ code: 'OWNER_DEACTIVATED', recipients: RECIPIENTS }),
      tx,
    );
    expect(lifecycle.apply).toHaveBeenNthCalledWith(
      2,
      'inc-2',
      'RESPONDING',
      'NOTIFY_BACKUP',
      { kind: 'SYSTEM' },
      expect.objectContaining({ code: 'OWNER_DEACTIVATED' }),
      tx,
    );
  });

  it('does nothing for a member who owns no active incident', async () => {
    incidents.ownedActive.mockResolvedValue([]);
    await expect(listener.onMemberDeactivated({ userId: 'u-2' })).resolves.toBe(0);
    expect(events.transaction).not.toHaveBeenCalled();
  });

  it('skips an incident a person or an SOS moved first, and keeps going', async () => {
    lifecycle.apply
      .mockRejectedValueOnce(
        new DomainException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATE_TRANSITION, 'Moved.'),
      )
      .mockResolvedValueOnce({});
    await expect(listener.onMemberDeactivated({ userId: 'u-1' })).resolves.toBe(1);
    expect(lifecycle.apply).toHaveBeenCalledTimes(2);
  });

  it('logs any other failure and moves the rest', async () => {
    const error = jest
      .spyOn((listener as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    lifecycle.apply.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce({});

    await expect(listener.onMemberDeactivated({ userId: 'u-1' })).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('inc-1'));
  });

  it('logs a failed read instead of rejecting the event', async () => {
    const error = jest
      .spyOn((listener as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    incidents.ownedActive.mockRejectedValue('down');

    await expect(listener.onMemberDeactivated({ userId: 'u-1' })).resolves.toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('u-1'));
  });
});
