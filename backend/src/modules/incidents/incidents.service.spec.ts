import { Incident, IncidentState, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { DomainException } from '../../common/errors';
import { HttpStatus } from '@nestjs/common';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsRepository } from './incidents.repository';
import { IncidentsService } from './incidents.service';
import { OrganizationsService } from '../organizations';

const OPERATOR: Caller = { id: 'owner', roles: ['ORG_OPERATOR'], organizationId: 'org-a' };
const STAFF: Caller = { id: 'staff', roles: ['STAFF'], organizationId: null };
const GUEST_OWNER: Caller = { ...OPERATOR, roles: ['GUEST'] };
const EMPTY = { primary: [], backup: [], managers: [], staff: [] };
const DUE_BEFORE = new Date('2026-10-26T01:00:00Z');

const row = (state: IncidentState, patch: Partial<Incident> = {}): Incident =>
  ({
    id: 'incident',
    deviceId: 'device',
    organizationId: 'org-a',
    state,
    version: 4,
    ownerId: 'owner',
    statusDueAt: DUE_BEFORE,
    ...patch,
  }) as Incident;

describe('IncidentsService task 4.1', () => {
  const tx = { marker: 'tx' } as unknown as Prisma.TransactionClient;
  let current: Incident | null;
  let repository: {
    lockById: jest.Mock;
    insertStatusUpdate: jest.Mock;
    findStatusUpdateForCorrection: jest.Mock;
    resetStatusDue: jest.Mock;
    latestAcknowledgement?: jest.Mock;
  };
  let lifecycle: { apply: jest.Mock };
  let parameters: { get: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let service: IncidentsService;
  let organizations: { memberNames: jest.Mock };
  const applyCall = (n: number) =>
    lifecycle.apply.mock.calls[n] as Parameters<IncidentLifecycle['apply']>;

  beforeEach(() => {
    current = row('NOTIFY_PRIMARY', { ownerId: null });
    repository = {
      lockById: jest.fn().mockImplementation(() => Promise.resolve(current)),
      insertStatusUpdate: jest
        .fn()
        .mockImplementation((data: { note: string; createdAt: Date }) =>
          Promise.resolve({ id: 'update-1', ...data }),
        ),
      findStatusUpdateForCorrection: jest.fn().mockResolvedValue(null),
      resetStatusDue: jest.fn().mockResolvedValue(undefined),
    };
    lifecycle = { apply: jest.fn().mockResolvedValue({ id: 'incident', state: 'APPLIED' }) };
    parameters = { get: jest.fn().mockResolvedValue(30) };
    organizations = { memberNames: jest.fn().mockResolvedValue(new Map()) };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    service = new IncidentsService(
      repository as unknown as IncidentsRepository,
      lifecycle as unknown as IncidentLifecycle,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
      organizations as unknown as OrganizationsService,
    );
  });

  const expectError = async (promise: Promise<unknown>, status: number, code: ErrorCode) => {
    const error: unknown = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainException);
    expect(error).toMatchObject({ errorCode: code });
    expect((error as DomainException).getStatus()).toBe(status);
  };

  describe('Staff false alarm (TK-147)', () => {
    it.each(['STAFF', 'ADMIN'])(
      'lets %s declare UNROUTED false with a Staff actor',
      async (role) => {
        current = row('UNROUTED', { organizationId: null });
        await service.falseAlarm(
          'incident',
          { expectedVersion: 4, reason: ' Confirmed safe ' },
          { ...STAFF, roles: [role] },
        );
        expect(applyCall(0)).toEqual([
          'incident',
          'UNROUTED',
          'FALSE_ALARM',
          { kind: 'STAFF', id: STAFF.id, roles: [role] },
          {
            code: 'FALSE_ALARM',
            expectedVersion: 4,
            note: 'Confirmed safe',
            at: applyCall(0)[4].at,
            recipients: EMPTY,
          },
          tx,
        ]);
      },
    );

    it.each(Object.values(IncidentState).filter((state) => state !== 'UNROUTED'))(
      'refuses Staff from %s',
      async (state) => {
        current = row(state);
        await expectError(
          service.falseAlarm('incident', { expectedVersion: 4, reason: 'safe' }, STAFF),
          409,
          ErrorCode.INVALID_STATE_TRANSITION,
        );
        expect(lifecycle.apply).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for a missing incident', async () => {
      current = null;
      await expectError(
        service.falseAlarm('missing', { expectedVersion: 4, reason: 'safe' }, STAFF),
        404,
        ErrorCode.NOT_FOUND,
      );
    });

    it('propagates a stale version without another write', async () => {
      current = row('UNROUTED', { organizationId: null });
      const stale = new DomainException(HttpStatus.CONFLICT, ErrorCode.STALE_VERSION, 'Reload');
      lifecycle.apply.mockRejectedValue(stale);
      await expect(
        service.falseAlarm('incident', { expectedVersion: 3, reason: 'safe' }, STAFF),
      ).rejects.toBe(stale);
    });

    it.each([STAFF, OPERATOR])('rejects a blank reason for $id', async (caller) => {
      await expectError(
        service.falseAlarm('incident', { expectedVersion: 4, reason: ' ' }, caller),
        400,
        ErrorCode.VALIDATION_FAILED,
      );
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it.each([
      {
        caller: OPERATOR,
        current: row('UNROUTED', { organizationId: null }),
        code: ErrorCode.NOT_FOUND,
      },
      {
        caller: OPERATOR,
        current: row('NOTIFY_PRIMARY', { organizationId: 'org-b' }),
        code: ErrorCode.NOT_FOUND,
      },
      {
        caller: { ...STAFF, roles: ['GUEST'] },
        current: row('UNROUTED'),
        code: ErrorCode.FORBIDDEN,
      },
    ])('keeps member isolation and rejects a non-Staff TrekLink account', async (example) => {
      current = example.current;
      await expect(
        service.falseAlarm('incident', { expectedVersion: 4, reason: 'safe' }, example.caller),
      ).rejects.toMatchObject({ errorCode: example.code });
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });
  });

  describe('acknowledge', () => {
    it.each([
      'NOTIFY_PRIMARY',
      'NOTIFY_BACKUP',
      'NOTIFY_MANAGER',
      'ESCALATED',
      'REPORTED',
    ] as const)(
      'locks the row and hands its %s state to the lifecycle with the request time',
      async (state) => {
        current = row(state, { ownerId: state === 'ESCALATED' ? 'silent' : null });
        const before = Date.now();
        await expect(
          service.acknowledge('incident', { expectedVersion: 4, note: '  On my way  ' }, OPERATOR),
        ).resolves.toEqual({ id: 'incident', state: 'APPLIED' });
        expect(repository.lockById).toHaveBeenCalledWith('incident', tx);
        const [id, from, to, actor, reason, client] = lifecycle.apply.mock.calls[0] as [
          string,
          IncidentState,
          IncidentState,
          unknown,
          { at: Date },
          unknown,
        ];
        expect([id, from, to, client]).toEqual(['incident', state, 'ACKNOWLEDGED', tx]);
        expect(actor).toEqual({
          kind: 'MEMBER',
          id: 'owner',
          organizationId: 'org-a',
          roles: ['ORG_OPERATOR'],
        });
        expect(reason).toMatchObject({
          code: 'ACKNOWLEDGED',
          expectedVersion: 4,
          note: 'On my way',
          recipients: EMPTY,
        });
        expect(reason.at.getTime()).toBeGreaterThanOrEqual(before);
        expect(reason.at.getTime()).toBeLessThanOrEqual(Date.now());
      },
    );

    it('treats a blank optional note as absent', async () => {
      await service.acknowledge('incident', { expectedVersion: 4, note: '   ' }, OPERATOR);
      expect(applyCall(0)[4]).toMatchObject({ note: undefined });
      await service.acknowledge('incident', { expectedVersion: 4 }, OPERATOR);
      expect(applyCall(1)[4]).toMatchObject({ note: undefined });
    });

    it('passes the locked ACKNOWLEDGED state so a concurrent loser gets MSG27 with the owner and time', async () => {
      current = row('ACKNOWLEDGED', { ownerId: 'winner' });
      const owned = new DomainException(HttpStatus.CONFLICT, ErrorCode.ALREADY_OWNED, 'owned');
      lifecycle.apply.mockRejectedValueOnce(owned);
      repository.latestAcknowledgement = jest
        .fn()
        .mockResolvedValue({ actorId: 'winner', createdAt: new Date('2026-10-20T03:15:00Z') });
      organizations.memberNames.mockResolvedValue(new Map([['winner', 'Pham Van D']]));
      await expect(
        service.acknowledge('incident', { expectedVersion: 4 }, OPERATOR),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.ALREADY_OWNED,
        message: 'Pham Van D took this incident at 10:15.',
      });
      expect(applyCall(0)[1]).toBe('ACKNOWLEDGED');
      expect(organizations.memberNames).toHaveBeenCalledWith(['winner']);
    });

    it('falls back to a generic MSG27 when no acknowledgement row is readable', async () => {
      lifecycle.apply.mockRejectedValueOnce(
        new DomainException(HttpStatus.CONFLICT, ErrorCode.ALREADY_OWNED, 'owned'),
      );
      repository.latestAcknowledgement = jest.fn().mockResolvedValue(null);
      await expect(
        service.acknowledge('incident', { expectedVersion: 4 }, OPERATOR),
      ).rejects.toMatchObject({ message: 'Another member took this incident.' });
      expect(organizations.memberNames).toHaveBeenCalledWith([]);
    });

    it('rethrows any other acknowledge failure unchanged', async () => {
      const other = new DomainException(HttpStatus.CONFLICT, ErrorCode.STALE_VERSION, 'stale');
      lifecycle.apply.mockRejectedValueOnce(other);
      await expect(service.acknowledge('incident', { expectedVersion: 4 }, OPERATOR)).rejects.toBe(
        other,
      );
    });

    it('declares a false alarm with the trimmed reason as the note', async () => {
      await service.falseAlarm(
        'incident',
        { expectedVersion: 2, reason: '  pressed by mistake ' },
        OPERATOR,
      );
      expect(applyCall(0)[2]).toBe('FALSE_ALARM');
      expect(applyCall(0)[4]).toMatchObject({
        code: 'FALSE_ALARM',
        expectedVersion: 2,
        note: 'pressed by mistake',
      });
    });

    it('refuses a blank false-alarm reason before opening a transaction', async () => {
      await expectError(
        service.falseAlarm('incident', { expectedVersion: 2, reason: ' ' }, OPERATOR),
        400,
        ErrorCode.VALIDATION_FAILED,
      );
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it('refuses a TrekLink account before opening a transaction', async () => {
      await expectError(
        service.acknowledge('incident', { expectedVersion: 4 }, STAFF),
        403,
        ErrorCode.FORBIDDEN,
      );
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing incident', null],
      ['another organization', row('NOTIFY_PRIMARY', { organizationId: 'org-b' })],
      ['an unrouted incident', row('UNROUTED', { organizationId: null })],
    ])('answers 404 for %s without calling the lifecycle', async (_label, locked) => {
      current = locked;
      await expectError(
        service.acknowledge('incident', { expectedVersion: 4 }, OPERATOR),
        404,
        ErrorCode.NOT_FOUND,
      );
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });
  });

  describe('responding and resolve', () => {
    it('reports a response under way with the trimmed required note', async () => {
      current = row('ACKNOWLEDGED');
      await service.responding('incident', { expectedVersion: 4, note: ' Team sent ' }, OPERATOR);
      expect(applyCall(0).slice(1, 3)).toEqual(['ACKNOWLEDGED', 'RESPONDING']);
      expect(applyCall(0)[4]).toMatchObject({
        code: 'RESPONDING',
        expectedVersion: 4,
        note: 'Team sent',
        recipients: EMPTY,
      });
    });

    it('resolves with the trimmed outcome note', async () => {
      current = row('RESPONDING');
      await service.resolve(
        'incident',
        { expectedVersion: 5, outcomeNote: ' Walked out ' },
        OPERATOR,
      );
      expect(applyCall(0).slice(1, 3)).toEqual(['RESPONDING', 'RESOLVED']);
      expect(applyCall(0)[4]).toMatchObject({
        code: 'RESOLVED',
        expectedVersion: 5,
        note: 'Walked out',
      });
    });

    it.each([
      [
        'responding',
        () => service.responding('incident', { expectedVersion: 4, note: ' ' }, OPERATOR),
      ],
      [
        'resolve',
        () => service.resolve('incident', { expectedVersion: 4, outcomeNote: '' }, OPERATOR),
      ],
    ])('%s refuses a blank note before opening a transaction', async (_label, call) => {
      await expectError(call(), 400, ErrorCode.VALIDATION_FAILED);
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it('lets the lifecycle decide ownership, so NOT_OWNER propagates unchanged', async () => {
      current = row('ACKNOWLEDGED', { ownerId: 'someone-else' });
      const notOwner = new DomainException(HttpStatus.FORBIDDEN, ErrorCode.NOT_OWNER, 'no');
      lifecycle.apply.mockRejectedValueOnce(notOwner);
      await expect(
        service.resolve('incident', { expectedVersion: 4, outcomeNote: 'Done' }, OPERATOR),
      ).rejects.toBe(notOwner);
    });
  });

  describe('addStatus', () => {
    it.each(['ACKNOWLEDGED', 'RESPONDING'] as const)(
      'appends a note in %s, restarts the stale timer and emits after commit',
      async (state) => {
        current = row(state);
        const before = Date.now();
        const result = await service.addStatus('incident', { note: ' At the ridge ' }, OPERATOR);
        expect(parameters.get).toHaveBeenCalledWith('incidents.staleLimitMinutes', tx);
        const [data, client] = repository.insertStatusUpdate.mock.calls[0] as [
          { incidentId: string; authorId: string; note: string; createdAt: Date },
          unknown,
        ];
        expect(client).toBe(tx);
        expect(data).toMatchObject({
          incidentId: 'incident',
          authorId: 'owner',
          note: 'At the ridge',
        });
        expect(data.createdAt.getTime()).toBeGreaterThanOrEqual(before);
        const due = new Date(data.createdAt.getTime() + 30 * 60000);
        expect(repository.resetStatusDue).toHaveBeenCalledWith('incident', due, tx);
        expect(result).toEqual({
          id: 'update-1',
          note: 'At the ridge',
          createdAt: data.createdAt,
          statusDueAt: due,
          correctsId: null,
        });
        expect(data).toMatchObject({ correctsId: null });
        expect(repository.findStatusUpdateForCorrection).not.toHaveBeenCalled();
        expect(lifecycle.apply).not.toHaveBeenCalled();
        expect(events.emitAfterCommit).toHaveBeenCalledWith('incident.changed', {
          incidentId: 'incident',
          deviceId: 'device',
          organizationId: 'org-a',
          state,
          tier: null,
          ownerId: 'owner',
        });
        expect(events.emitAfterCommit).toHaveBeenCalledWith(
          'audit.record',
          expect.objectContaining({
            actorId: 'owner',
            action: 'incident.status_update',
            subjectId: 'incident',
            before: { statusDueAt: DUE_BEFORE },
            after: { statusDueAt: due, statusUpdateId: 'update-1', correctsId: null },
          }),
        );
      },
    );

    it.each([
      [
        'ESCALATED with the kept owner',
        row('ESCALATED'),
        OPERATOR,
        409,
        ErrorCode.INVALID_STATE_TRANSITION,
      ],
      ['RESOLVED', row('RESOLVED'), OPERATOR, 409, ErrorCode.INVALID_STATE_TRANSITION],
      [
        'another member',
        row('RESPONDING', { ownerId: 'other' }),
        OPERATOR,
        403,
        ErrorCode.NOT_OWNER,
      ],
      ['an owner without a member role', row('RESPONDING'), GUEST_OWNER, 403, ErrorCode.FORBIDDEN],
      [
        'another organization',
        row('RESPONDING', { organizationId: 'org-b' }),
        OPERATOR,
        404,
        ErrorCode.NOT_FOUND,
      ],
    ] as const)('refuses %s and writes nothing', async (_label, locked, caller, status, code) => {
      current = locked;
      await expectError(service.addStatus('incident', { note: 'x' }, caller), status, code);
      expect(repository.insertStatusUpdate).not.toHaveBeenCalled();
      expect(repository.resetStatusDue).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('refuses a blank note and a TrekLink account before opening a transaction', async () => {
      await expectError(
        service.addStatus('incident', { note: ' ' }, OPERATOR),
        400,
        ErrorCode.VALIDATION_FAILED,
      );
      await expectError(
        service.addStatus('incident', { note: 'x' }, STAFF),
        403,
        ErrorCode.FORBIDDEN,
      );
      expect(events.transaction).not.toHaveBeenCalled();
    });
  });

  // Dry run defect 15: a correction is a new row naming the one it corrects; nothing is edited.
  describe('addStatus with correctsId', () => {
    beforeEach(() => {
      current = row('RESPONDING');
    });

    it('appends a correction of an uncorrected update of the same incident', async () => {
      repository.findStatusUpdateForCorrection.mockResolvedValue({
        id: 'update-0',
        incidentId: 'incident',
        correctedBy: null,
      });
      const result = await service.addStatus(
        'incident',
        { note: 'At the second ridge', correctsId: 'update-0' },
        OPERATOR,
      );
      expect(repository.findStatusUpdateForCorrection).toHaveBeenCalledWith('update-0', tx);
      expect(repository.insertStatusUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'At the second ridge', correctsId: 'update-0' }),
        tx,
      );
      expect(result.correctsId).toBe('update-0');
      expect(repository.resetStatusDue).toHaveBeenCalled();
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        'audit.record',
        expect.objectContaining({
          after: expect.objectContaining({ correctsId: 'update-0' }) as unknown,
        }),
      );
    });

    it.each([
      ['an unknown id', null, 400, ErrorCode.VALIDATION_FAILED],
      [
        'an update of another incident',
        { id: 'update-0', incidentId: 'other-incident', correctedBy: null },
        400,
        ErrorCode.VALIDATION_FAILED,
      ],
      [
        'an update already corrected',
        { id: 'update-0', incidentId: 'incident', correctedBy: { id: 'update-1' } },
        409,
        ErrorCode.CONFLICT_UNIQUE,
      ],
    ] as const)('refuses %s and writes nothing', async (_label, target, status, code) => {
      repository.findStatusUpdateForCorrection.mockResolvedValue(target);
      await expectError(
        service.addStatus('incident', { note: 'x', correctsId: 'update-0' }, OPERATOR),
        status,
        code,
      );
      expect(repository.insertStatusUpdate).not.toHaveBeenCalled();
      expect(repository.resetStatusDue).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it.each(['RESOLVED', 'CLOSED'] as const)(
      'refuses a correction on a %s incident before it reads the corrected update',
      async (state) => {
        current = row(state);
        await expectError(
          service.addStatus('incident', { note: 'x', correctsId: 'update-0' }, OPERATOR),
          409,
          ErrorCode.INVALID_STATE_TRANSITION,
        );
        expect(repository.findStatusUpdateForCorrection).not.toHaveBeenCalled();
        expect(repository.insertStatusUpdate).not.toHaveBeenCalled();
      },
    );

    it('checks ownership before it reads the corrected update', async () => {
      current = row('RESPONDING', { ownerId: 'other' });
      await expectError(
        service.addStatus('incident', { note: 'x', correctsId: 'update-0' }, OPERATOR),
        403,
        ErrorCode.NOT_OWNER,
      );
      expect(repository.findStatusUpdateForCorrection).not.toHaveBeenCalled();
    });
  });
});

describe('IncidentsService.markDeviceStale (task 4.4, REQ-EVT-12)', () => {
  const tx = { marker: 'tx' } as unknown as Prisma.TransactionClient;
  const LAST_SEEN = new Date('2026-11-01T02:55:00.000Z');
  let open: Incident | null;
  let repository: { lockOpenByDevice: jest.Mock; setStale: jest.Mock };
  let events: { emitAfterCommit: jest.Mock };
  let service: IncidentsService;

  beforeEach(() => {
    open = row('NOTIFY_BACKUP', { ownerId: null, stale: false });
    repository = {
      lockOpenByDevice: jest.fn(() => Promise.resolve(open)),
      setStale: jest.fn((id: string, stale: boolean) => Promise.resolve({ ...open, id, stale })),
    };
    events = { emitAfterCommit: jest.fn() };
    service = new IncidentsService(
      repository as unknown as IncidentsRepository,
      {} as IncidentLifecycle,
      {} as ParameterService,
      events as unknown as TransactionalEvents,
      {} as OrganizationsService,
    );
  });

  it("flags the device's open incident under its lock in the caller's transaction", async () => {
    await expect(service.markDeviceStale('device', true, LAST_SEEN, tx)).resolves.toMatchObject({
      id: 'incident',
      stale: true,
    });
    expect(repository.lockOpenByDevice).toHaveBeenCalledWith('device', tx);
    expect(repository.setStale).toHaveBeenCalledWith('incident', true, tx);
  });

  it('announces the unchanged state with incident.changed, so lists and the map refresh', async () => {
    await service.markDeviceStale('device', true, LAST_SEEN, tx);
    expect(events.emitAfterCommit).toHaveBeenCalledWith('incident.changed', {
      incidentId: 'incident',
      deviceId: 'device',
      organizationId: 'org-a',
      state: 'NOTIFY_BACKUP',
      tier: 'BACKUP',
      ownerId: null,
    });
  });

  it('audits the flag as a system change with the last-seen time', async () => {
    await service.markDeviceStale('device', true, LAST_SEEN, tx);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      'audit.record',
      expect.objectContaining({
        actorId: null,
        action: 'incident.stale',
        subjectId: 'incident',
        before: { stale: false },
        after: { stale: true, lastSeenAt: LAST_SEEN.toISOString() },
      }),
    );
  });

  it('clears the flag when the device is heard again', async () => {
    open = row('ACKNOWLEDGED', { stale: true });
    await service.markDeviceStale('device', false, LAST_SEEN, tx);
    expect(repository.setStale).toHaveBeenCalledWith('incident', false, tx);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      'incident.changed',
      expect.objectContaining({ state: 'ACKNOWLEDGED', tier: null, ownerId: 'owner' }),
    );
  });

  it('clears the flag of a device reset to never heard, auditing no last-seen time', async () => {
    open = row('NOTIFY_BACKUP', { stale: true });
    await service.markDeviceStale('device', false, null, tx);
    expect(repository.setStale).toHaveBeenCalledWith('incident', false, tx);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      'audit.record',
      expect.objectContaining({
        before: { stale: true },
        after: { stale: false, lastSeenAt: null },
      }),
    );
  });

  it('does nothing when the flag already says so', async () => {
    open = row('RESPONDING', { stale: true });
    await expect(service.markDeviceStale('device', true, LAST_SEEN, tx)).resolves.toBeNull();
    expect(repository.setStale).not.toHaveBeenCalled();
    expect(events.emitAfterCommit).not.toHaveBeenCalled();
  });

  it('does nothing for a device with no incident outside CLOSED', async () => {
    open = null;
    await expect(service.markDeviceStale('device', true, LAST_SEEN, tx)).resolves.toBeNull();
    expect(repository.setStale).not.toHaveBeenCalled();
    expect(events.emitAfterCommit).not.toHaveBeenCalled();
  });
});
