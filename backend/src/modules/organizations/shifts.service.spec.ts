import { OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { OrganizationsRepository } from './organizations.repository';
import { RosterRepository, ShiftRow } from './roster.repository';
import { noPrimaryGaps, ShiftsService } from './shifts.service';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-10-30T03:00:00.000Z');
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const at = (iso: string) => new Date(iso);
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const member = (id: string | null) => (id ? { id, userId: `u-${id}` } : null);
const shiftRow = (
  id: string,
  startsAt: Date,
  endsAt: Date,
  primary: string | null = null,
  backup: string | null = null,
): ShiftRow => ({
  id,
  startsAt,
  endsAt,
  primaryMember: member(primary),
  backupMember: member(backup),
});
// An invited account is created active and has no password until its holder sets one.
const card = (userId: string, passwordSet = true, isActive = true) => ({
  id: userId,
  email: `${userId}@example.com`,
  fullName: `Name ${userId}`,
  phoneNumber: null,
  isActive,
  passwordSet,
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainException) return error.errorCode;
    throw error;
  }
  return 'NONE';
};

describe('noPrimaryGaps (REQ-STA-02)', () => {
  const span = (a: number, b: number, hasPrimary = true) => ({
    startsAt: hours(a),
    endsAt: hours(b),
    hasPrimary,
  });

  it('is the whole window when no shift covers it', () => {
    expect(noPrimaryGaps(hours(0), hours(10), [])).toEqual([{ from: hours(0), to: hours(10) }]);
  });

  it('returns the parts before, between and after the shifts that have a primary', () => {
    expect(noPrimaryGaps(hours(0), hours(10), [span(2, 4), span(6, 8)])).toEqual([
      { from: hours(0), to: hours(2) },
      { from: hours(4), to: hours(6) },
      { from: hours(8), to: hours(10) },
    ]);
  });

  it('treats a shift without a primary as a gap, and merges what touches', () => {
    expect(
      noPrimaryGaps(hours(0), hours(10), [span(0, 4), span(4, 7, false), span(7, 10)]),
    ).toEqual([{ from: hours(4), to: hours(7) }]);
  });

  it('clips shifts to the window, ignores the ones outside it, and copes with overlapping spans', () => {
    expect(
      noPrimaryGaps(hours(2), hours(8), [
        span(-5, 3),
        span(1, 4),
        span(20, 30),
        span(-9, -8),
        span(7, 12),
      ]),
    ).toEqual([{ from: hours(4), to: hours(7) }]);
  });

  it('is empty when the primary covers the whole window', () => {
    expect(noPrimaryGaps(hours(0), hours(10), [span(-1, 11)])).toEqual([]);
  });
});

describe('ShiftsService (organizations 2.6, api-design 16 to 19)', () => {
  let roster: Record<string, jest.Mock>;
  let organizations: { lockById: jest.Mock };
  let accounts: { contactCard: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let service: ShiftsService;

  beforeEach(() => {
    roster = {
      shiftsBetween: jest.fn().mockResolvedValue([]),
      findShift: jest.fn().mockResolvedValue(null),
      overlaps: jest.fn().mockResolvedValue(false),
      liveMembers: jest
        .fn()
        .mockImplementation((_org: string, ids: string[]) =>
          ids.map((id) => ({ id, userId: `u-${id}` })),
        ),
      insertShift: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          shiftRow(
            's-new',
            data.startsAt as Date,
            data.endsAt as Date,
            data.primaryMemberId as string | null,
            data.backupMemberId as string | null,
          ),
        ),
      updateShift: jest.fn(),
      deleteShift: jest.fn().mockResolvedValue(undefined),
    };
    organizations = {
      lockById: jest.fn().mockResolvedValue({ id: 'org-1', status: OrganizationStatus.ACTIVE }),
    };
    accounts = {
      contactCard: jest
        .fn()
        .mockImplementation((ids: string[]) => ids.map((userId) => card(userId))),
    };
    emitted = [];
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    service = new ShiftsService(
      roster as unknown as RosterRepository,
      organizations as unknown as OrganizationsRepository,
      accounts as unknown as AccountsService,
      events as unknown as TransactionalEvents,
    );
  });

  describe('list (api-design 16)', () => {
    it('returns the shifts with names and a NO_PRIMARY warning for each gap from now on', async () => {
      roster.shiftsBetween.mockResolvedValue([
        shiftRow('s-1', hours(-2), hours(4), 'm-1', null),
        shiftRow('s-2', hours(6), hours(9), null, 'm-2'),
      ]);

      const result = await service.list('org-1', hours(-5), hours(12), MANAGER, NOW);

      expect(roster.shiftsBetween).toHaveBeenCalledWith('org-1', hours(-5), hours(12));
      expect(result.shifts).toEqual([
        {
          id: 's-1',
          startsAt: hours(-2),
          endsAt: hours(4),
          primary: { memberId: 'm-1', fullName: 'Name u-m-1' },
          backup: null,
        },
        {
          id: 's-2',
          startsAt: hours(6),
          endsAt: hours(9),
          primary: null,
          backup: { memberId: 'm-2', fullName: 'Name u-m-2' },
        },
      ]);
      expect(result.warnings).toEqual([{ kind: 'NO_PRIMARY', from: hours(4), to: hours(12) }]);
    });

    it('does not warn about a gap that is already past, or about a window wholly in the past', async () => {
      const partly = await service.list('org-1', hours(-10), hours(6), MANAGER, NOW);
      expect(partly.warnings).toEqual([{ kind: 'NO_PRIMARY', from: NOW, to: hours(6) }]);

      const past = await service.list('org-1', hours(-10), hours(-2), MANAGER, NOW);
      expect(past.warnings).toEqual([]);
    });

    it('shows a deactivated or missing name as an empty string', async () => {
      roster.shiftsBetween.mockResolvedValue([shiftRow('s-1', hours(1), hours(2), 'm-1')]);
      accounts.contactCard.mockResolvedValue([]);
      const result = await service.list('org-1', hours(0), hours(3), MANAGER, NOW);
      expect(result.shifts[0].primary).toEqual({ memberId: 'm-1', fullName: '' });
    });

    it('refuses a window that is empty, longer than 31 days, or another organization', async () => {
      expect(await codeOf(service.list('org-1', hours(5), hours(5), MANAGER, NOW))).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      expect(await codeOf(service.list('org-1', hours(0), hours(31 * 24 + 1), MANAGER, NOW))).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      await expect(
        service.list('org-1', hours(0), hours(31 * 24), MANAGER, NOW),
      ).resolves.toMatchObject({ shifts: [] });
      expect(await codeOf(service.list('org-9', hours(0), hours(5), MANAGER, NOW))).toBe(
        ErrorCode.NOT_FOUND,
      );
      expect(roster.shiftsBetween).toHaveBeenCalledTimes(1);
    });
  });

  describe('create (api-design 17)', () => {
    const INPUT = {
      startsAt: hours(2),
      endsAt: hours(10),
      primaryMemberId: 'm-1',
      backupMemberId: 'm-2',
    };

    it('inserts the shift in a locked transaction, records it, and warns of nothing when both slots are filled', async () => {
      const result = await service.create('org-1', INPUT, MANAGER, NOW);

      expect(organizations.lockById).toHaveBeenCalledWith('org-1', TX);
      expect(roster.overlaps).toHaveBeenCalledWith('org-1', hours(2), hours(10), null, TX);
      expect(roster.insertShift).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          startsAt: hours(2),
          endsAt: hours(10),
          primaryMemberId: 'm-1',
          backupMemberId: 'm-2',
          createdById: 'u-mgr',
        },
        TX,
      );
      expect(result.shift).toMatchObject({
        id: 's-new',
        primary: { memberId: 'm-1', fullName: 'Name u-m-1' },
        backup: { memberId: 'm-2', fullName: 'Name u-m-2' },
      });
      expect(result.warnings).toEqual([]);
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            actorId: 'u-mgr',
            organizationId: 'org-1',
            action: 'roster.shiftCreated',
            subjectType: 'RosterShift',
            subjectId: 's-new',
            before: null,
          }),
        ],
      ]);
    });

    it('warns NO_BACKUP for a shift without a backup and NO_PRIMARY, with its window, for one without a primary', async () => {
      const noBackup = await service.create(
        'org-1',
        { startsAt: hours(2), endsAt: hours(4), primaryMemberId: 'm-1' },
        MANAGER,
        NOW,
      );
      expect(noBackup.warnings).toEqual([{ kind: 'NO_BACKUP' }]);

      const nobody = await service.create(
        'org-1',
        { startsAt: hours(2), endsAt: hours(4) },
        MANAGER,
        NOW,
      );
      expect(nobody.warnings).toEqual([
        { kind: 'NO_PRIMARY', from: hours(2), to: hours(4) },
        { kind: 'NO_BACKUP' },
      ]);
      expect(roster.liveMembers).toHaveBeenCalledTimes(1);
    });

    it('accepts a shift in progress and one of exactly 31 days', async () => {
      await expect(
        service.create(
          'org-1',
          { startsAt: hours(-1), endsAt: hours(1), primaryMemberId: 'm-1' },
          MANAGER,
          NOW,
        ),
      ).resolves.toMatchObject({ shift: { id: 's-new' } });
      await expect(
        service.create('org-1', { startsAt: hours(1), endsAt: hours(1 + 31 * 24) }, MANAGER, NOW),
      ).resolves.toMatchObject({ shift: { id: 's-new' } });
    });

    it('refuses a window that is backwards, already ended, longer than 31 days, and writes nothing', async () => {
      for (const input of [
        { startsAt: hours(5), endsAt: hours(5) },
        { startsAt: hours(-5), endsAt: hours(-1) },
        { startsAt: hours(-5), endsAt: NOW },
        { startsAt: hours(1), endsAt: hours(2 + 31 * 24) },
      ]) {
        expect(await codeOf(service.create('org-1', input, MANAGER, NOW))).toBe(
          ErrorCode.VALIDATION_FAILED,
        );
      }
      expect(roster.insertShift).not.toHaveBeenCalled();
    });

    it('refuses the same member in both slots, a member who is not live, and an account with no password yet (MEMBER_NOT_ELIGIBLE)', async () => {
      expect(
        await codeOf(service.create('org-1', { ...INPUT, backupMemberId: 'm-1' }, MANAGER, NOW)),
      ).toBe(ErrorCode.MEMBER_NOT_ELIGIBLE);

      roster.liveMembers.mockResolvedValueOnce([{ id: 'm-1', userId: 'u-m-1' }]);
      expect(await codeOf(service.create('org-1', INPUT, MANAGER, NOW))).toBe(
        ErrorCode.MEMBER_NOT_ELIGIBLE,
      );

      accounts.contactCard.mockResolvedValueOnce([card('u-m-1'), card('u-m-2', false)]);
      expect(await codeOf(service.create('org-1', INPUT, MANAGER, NOW))).toBe(
        ErrorCode.MEMBER_NOT_ELIGIBLE,
      );

      // A deactivated account that still has its password is not eligible either.
      accounts.contactCard.mockResolvedValueOnce([card('u-m-1'), card('u-m-2', true, false)]);
      expect(await codeOf(service.create('org-1', INPUT, MANAGER, NOW))).toBe(
        ErrorCode.MEMBER_NOT_ELIGIBLE,
      );
      expect(roster.insertShift).not.toHaveBeenCalled();
    });

    it('answers 409 SHIFT_OVERLAP when another shift overlaps, and when the database constraint fires', async () => {
      roster.overlaps.mockResolvedValueOnce(true);
      expect(await codeOf(service.create('org-1', INPUT, MANAGER, NOW))).toBe(
        ErrorCode.SHIFT_OVERLAP,
      );
      expect(roster.insertShift).not.toHaveBeenCalled();

      roster.insertShift.mockRejectedValueOnce(
        new Error('Raw query failed. conflicting key value violates "roster_shifts_no_overlap"'),
      );
      expect(await codeOf(service.create('org-1', INPUT, MANAGER, NOW))).toBe(
        ErrorCode.SHIFT_OVERLAP,
      );

      roster.insertShift.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.create('org-1', INPUT, MANAGER, NOW)).rejects.toThrow('connection lost');
      roster.insertShift.mockRejectedValueOnce('exclusion violation 23P01');
      await expect(service.create('org-1', INPUT, MANAGER, NOW)).rejects.toBe(
        'exclusion violation 23P01',
      );
    });

    it('refuses another organization, a missing one, and a status that is not ACTIVE or SUSPENDED', async () => {
      expect(await codeOf(service.create('org-9', INPUT, MANAGER, NOW))).toBe(ErrorCode.NOT_FOUND);
      expect(organizations.lockById).not.toHaveBeenCalled();

      organizations.lockById.mockResolvedValueOnce(null);
      expect(await codeOf(service.create('org-1', INPUT, MANAGER, NOW))).toBe(ErrorCode.NOT_FOUND);

      organizations.lockById.mockResolvedValueOnce({
        id: 'org-1',
        status: OrganizationStatus.SUSPENDED,
      });
      await expect(service.create('org-1', INPUT, MANAGER, NOW)).resolves.toBeDefined();

      for (const status of [
        OrganizationStatus.PENDING,
        OrganizationStatus.REJECTED,
        OrganizationStatus.CLOSED,
      ]) {
        organizations.lockById.mockResolvedValueOnce({ id: 'org-1', status });
        const error = await service.create('org-1', INPUT, MANAGER, NOW).catch((e: unknown) => e);
        expect((error as DomainException).errorCode).toBe(ErrorCode.INVALID_STATE_TRANSITION);
        expect((error as DomainException).message).toBe(
          `This cannot be done while it is ${status}.`,
        );
      }
    });
  });

  describe('update (api-design 18)', () => {
    const FUTURE = shiftRow('s-1', hours(5), hours(9), 'm-1', 'm-2');
    const STARTED = shiftRow('s-2', hours(-2), hours(4), 'm-1', 'm-2');

    it('moves an unstarted shift, checks overlap without itself, and records before and after', async () => {
      roster.findShift.mockResolvedValue(FUTURE);
      roster.updateShift.mockResolvedValue(shiftRow('s-1', hours(6), hours(10), 'm-1', 'm-2'));

      const result = await service.update(
        'org-1',
        's-1',
        { startsAt: hours(6), endsAt: hours(10) },
        MANAGER,
        NOW,
      );

      expect(roster.overlaps).toHaveBeenCalledWith('org-1', hours(6), hours(10), 's-1', TX);
      expect(roster.updateShift).toHaveBeenCalledWith(
        's-1',
        { startsAt: hours(6), endsAt: hours(10) },
        TX,
      );
      expect(result.shift).toMatchObject({ id: 's-1', startsAt: hours(6), endsAt: hours(10) });
      expect(emitted[0][1]).toMatchObject({
        action: 'roster.shiftChanged',
        subjectId: 's-1',
        before: { startsAt: hours(5), endsAt: hours(9) },
        after: { startsAt: hours(6), endsAt: hours(10) },
      });
    });

    it('changes members only when they differ, checks only the new ones, and empties a slot with null', async () => {
      roster.findShift.mockResolvedValue(FUTURE);
      roster.updateShift.mockResolvedValue(shiftRow('s-1', hours(5), hours(9), 'm-3', null));

      await service.update(
        'org-1',
        's-1',
        { primaryMemberId: 'm-3', backupMemberId: null },
        MANAGER,
        NOW,
      );

      expect(roster.liveMembers).toHaveBeenCalledWith('org-1', ['m-3'], TX);
      expect(roster.overlaps).not.toHaveBeenCalled();
      expect(roster.updateShift).toHaveBeenCalledWith(
        's-1',
        { primaryMemberId: 'm-3', backupMemberId: null },
        TX,
      );
    });

    it('refuses a new member who is not eligible, or one who would be both primary and backup', async () => {
      roster.findShift.mockResolvedValue(FUTURE);
      roster.liveMembers.mockResolvedValueOnce([]);
      expect(
        await codeOf(service.update('org-1', 's-1', { backupMemberId: 'm-9' }, MANAGER, NOW)),
      ).toBe(ErrorCode.MEMBER_NOT_ELIGIBLE);
      expect(
        await codeOf(service.update('org-1', 's-1', { backupMemberId: 'm-1' }, MANAGER, NOW)),
      ).toBe(ErrorCode.MEMBER_NOT_ELIGIBLE);
      expect(roster.updateShift).not.toHaveBeenCalled();
    });

    it('answers 409 SHIFT_OVERLAP for a window that now overlaps', async () => {
      roster.findShift.mockResolvedValue(FUTURE);
      roster.overlaps.mockResolvedValueOnce(true);
      expect(
        await codeOf(service.update('org-1', 's-1', { endsAt: hours(20) }, MANAGER, NOW)),
      ).toBe(ErrorCode.SHIFT_OVERLAP);
    });

    it('refuses a window that is backwards, ended, or too long for an unstarted shift', async () => {
      roster.findShift.mockResolvedValue(FUTURE);
      for (const patch of [
        { endsAt: hours(5) },
        { startsAt: hours(-9), endsAt: hours(-3) },
        { endsAt: hours(6 + 31 * 24) },
      ]) {
        expect(await codeOf(service.update('org-1', 's-1', patch, MANAGER, NOW))).toBe(
          ErrorCode.VALIDATION_FAILED,
        );
      }
    });

    it('lets only the end of a started shift change, and not before now (ruling 2026-10-30)', async () => {
      roster.findShift.mockResolvedValue(STARTED);
      roster.updateShift.mockResolvedValue(shiftRow('s-2', hours(-2), hours(6), 'm-1', 'm-2'));

      await expect(
        service.update('org-1', 's-2', { endsAt: hours(6) }, MANAGER, NOW),
      ).resolves.toMatchObject({ shift: { endsAt: hours(6) } });
      expect(roster.updateShift).toHaveBeenCalledWith('s-2', { endsAt: hours(6) }, TX);

      await expect(
        service.update('org-1', 's-2', { endsAt: NOW }, MANAGER, NOW),
      ).resolves.toBeDefined();

      expect(
        await codeOf(service.update('org-1', 's-2', { endsAt: hours(-1) }, MANAGER, NOW)),
      ).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('answers 409 SHIFT_STARTED for any other change to a started shift, and takes a field sent unchanged', async () => {
      roster.findShift.mockResolvedValue(STARTED);
      for (const patch of [
        { startsAt: hours(-1) },
        { primaryMemberId: 'm-3' },
        { backupMemberId: null },
        { primaryMemberId: null },
      ]) {
        const error = await service
          .update('org-1', 's-2', patch, MANAGER, NOW)
          .catch((e: unknown) => e);
        expect((error as DomainException).errorCode).toBe(ErrorCode.SHIFT_STARTED);
        expect((error as DomainException).message).toBe(
          'Only the end of a started shift can change.',
        );
      }
      expect(roster.updateShift).not.toHaveBeenCalled();

      roster.updateShift.mockResolvedValue(shiftRow('s-2', hours(-2), hours(5), 'm-1', 'm-2'));
      await expect(
        service.update(
          'org-1',
          's-2',
          { startsAt: hours(-2), primaryMemberId: 'm-1', backupMemberId: 'm-2', endsAt: hours(5) },
          MANAGER,
          NOW,
        ),
      ).resolves.toBeDefined();
      expect(roster.updateShift).toHaveBeenCalledWith('s-2', { endsAt: hours(5) }, TX);
    });

    it('returns the shift as it is, and writes nothing, when nothing changes', async () => {
      roster.findShift.mockResolvedValue(FUTURE);
      const result = await service.update('org-1', 's-1', { primaryMemberId: 'm-1' }, MANAGER, NOW);
      expect(result.shift.id).toBe('s-1');
      expect(result.warnings).toEqual([]);
      expect(roster.updateShift).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('answers 404 for an unknown shift, another organization, and 409 for a CLOSED organization', async () => {
      expect(await codeOf(service.update('org-1', 's-9', { endsAt: hours(9) }, MANAGER, NOW))).toBe(
        ErrorCode.NOT_FOUND,
      );
      expect(roster.findShift).toHaveBeenCalledWith('org-1', 's-9', TX);
      expect(await codeOf(service.update('org-2', 's-1', {}, MANAGER, NOW))).toBe(
        ErrorCode.NOT_FOUND,
      );
      organizations.lockById.mockResolvedValueOnce({
        id: 'org-1',
        status: OrganizationStatus.CLOSED,
      });
      expect(await codeOf(service.update('org-1', 's-1', {}, MANAGER, NOW))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
    });
  });

  describe('remove (api-design 19)', () => {
    it('deletes a shift that has not started and records it', async () => {
      roster.findShift.mockResolvedValue(shiftRow('s-1', hours(5), hours(9), 'm-1'));

      await expect(service.remove('org-1', 's-1', MANAGER, NOW)).resolves.toBeUndefined();

      expect(roster.deleteShift).toHaveBeenCalledWith('s-1', TX);
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            action: 'roster.shiftDeleted',
            subjectId: 's-1',
          }),
        ],
      ]);
      expect(emitted[0][1].before).toMatchObject({ shiftId: 's-1', primaryMemberId: 'm-1' });
    });

    it('refuses a shift that has started or ended with 409 SHIFT_STARTED, so the record stays', async () => {
      roster.findShift.mockResolvedValue(shiftRow('s-1', hours(-1), hours(3)));
      const error = await service.remove('org-1', 's-1', MANAGER, NOW).catch((e: unknown) => e);
      expect((error as DomainException).errorCode).toBe(ErrorCode.SHIFT_STARTED);
      expect((error as DomainException).message).toBe(
        'Shorten a started shift instead of deleting it.',
      );

      roster.findShift.mockResolvedValue(shiftRow('s-1', NOW, hours(3)));
      expect(await codeOf(service.remove('org-1', 's-1', MANAGER, NOW))).toBe(
        ErrorCode.SHIFT_STARTED,
      );
      expect(roster.deleteShift).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown shift and another organization, and refuses a PENDING organization', async () => {
      expect(await codeOf(service.remove('org-1', 's-9', MANAGER, NOW))).toBe(ErrorCode.NOT_FOUND);
      expect(await codeOf(service.remove('org-2', 's-1', MANAGER, NOW))).toBe(ErrorCode.NOT_FOUND);
      organizations.lockById.mockResolvedValueOnce({
        id: 'org-1',
        status: OrganizationStatus.PENDING,
      });
      expect(await codeOf(service.remove('org-1', 's-1', MANAGER, NOW))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
    });

    it('defaults the time to now', async () => {
      roster.findShift.mockResolvedValue(
        shiftRow('s-1', at('2999-01-01T00:00:00Z'), at('2999-01-02T00:00:00Z')),
      );
      await expect(service.remove('org-1', 's-1', MANAGER)).resolves.toBeUndefined();
    });
  });
});
