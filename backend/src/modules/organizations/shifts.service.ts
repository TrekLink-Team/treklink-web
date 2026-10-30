import { HttpStatus, Injectable } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { OrganizationsRepository } from './organizations.repository';
import { RosterRepository, ShiftRow } from './roster.repository';

export interface ShiftView {
  id: string;
  startsAt: Date;
  endsAt: Date;
  primary: { memberId: string; fullName: string } | null;
  backup: { memberId: string; fullName: string } | null;
}

// `NO_PRIMARY` carries its window (MSG22); `NO_BACKUP` is returned for a saved shift only.
export type RosterWarning = { kind: 'NO_PRIMARY'; from: Date; to: Date } | { kind: 'NO_BACKUP' };

export interface ShiftInput {
  startsAt: Date;
  endsAt: Date;
  primaryMemberId?: string | null;
  backupMemberId?: string | null;
}

// Absent is unchanged; null empties a member slot.
export type ShiftPatch = Partial<ShiftInput>;

const DAY_MS = 24 * 3_600_000;
// The longest shift, and the widest window a roster read may ask for (api-design 16).
const MAX_SPAN_MS = 31 * DAY_MS;

// Members can be managed while the organization is ACTIVE, and while it is SUSPENDED because its roster
// still resolves then (REQ-STA-01, BR-36). Any other status is refused.
const MANAGEABLE: ReadonlySet<OrganizationStatus> = new Set([
  OrganizationStatus.ACTIVE,
  OrganizationStatus.SUSPENDED,
]);

const notFound = (what: string) =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found.`);

const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);

const notEligible = () =>
  new DomainException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.MEMBER_NOT_ELIGIBLE,
    'Choose two different active members of your organization.',
  );

const overlap = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.SHIFT_OVERLAP,
    'This shift overlaps another one.',
  );

// The exclusion constraint of the database is the last guard against two shifts that overlap; its
// failure carries the constraint name and the Postgres code 23P01.
const isOverlapViolation = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : '';
  return text.includes('roster_shifts_no_overlap') || text.includes('23P01');
};

// The parts of `[from, to)` that no shift with a primary covers: no shift at all, or a shift whose
// primary slot is empty. Adjacent gaps come out merged.
export function noPrimaryGaps(
  from: Date,
  to: Date,
  shifts: readonly { startsAt: Date; endsAt: Date; hasPrimary: boolean }[],
): { from: Date; to: Date }[] {
  const covered = shifts
    .filter((shift) => shift.hasPrimary)
    .map((shift) => ({
      start: Math.max(shift.startsAt.getTime(), from.getTime()),
      end: Math.min(shift.endsAt.getTime(), to.getTime()),
    }))
    .filter((span) => span.start < span.end)
    .sort((a, b) => a.start - b.start);
  const gaps: { from: Date; to: Date }[] = [];
  let cursor = from.getTime();
  for (const span of covered) {
    if (span.start > cursor) gaps.push({ from: new Date(cursor), to: new Date(span.start) });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < to.getTime()) gaps.push({ from: new Date(cursor), to: to });
  return gaps;
}

// The on-duty roster of an organization, administered by its Org Managers (organizations task 2.6,
// api-design 16 to 19, UC-05, FR-ORG-05, BR-16). A change applies to the next alert tier, never to an
// alert already sent, so nothing is emitted for `incidents`. Every write locks the organization row,
// so two shifts for one organization are checked one after the other; the exclusion constraint of
// the database stays behind as the last guard. `RosterService.tiersAt` is the read `incidents` uses.
@Injectable()
export class ShiftsService {
  constructor(
    private readonly roster: RosterRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly accounts: AccountsService,
    private readonly events: TransactionalEvents,
  ) {}

  // api-design 16: the shifts touching `[from, to)`, and a `NO_PRIMARY` warning for every part of the
  // window from now on that no shift with a primary covers (MSG22, REQ-STA-02). Past gaps are not
  // warned about, so a week that has begun does not report its finished days.
  async list(
    organizationId: string,
    from: Date,
    to: Date,
    caller: Caller,
    now: Date = new Date(),
  ): Promise<{ shifts: ShiftView[]; warnings: RosterWarning[] }> {
    this.assertOwn(organizationId, caller);
    if (to.getTime() <= from.getTime()) throw invalid('to must be after from.');
    if (to.getTime() - from.getTime() > MAX_SPAN_MS) {
      throw invalid('The window is at most 31 days.');
    }
    const rows = await this.roster.shiftsBetween(organizationId, from, to);
    const warnFrom = new Date(Math.max(from.getTime(), now.getTime()));
    const gaps =
      warnFrom.getTime() < to.getTime()
        ? noPrimaryGaps(
            warnFrom,
            to,
            rows.map((row) => ({
              startsAt: row.startsAt,
              endsAt: row.endsAt,
              hasPrimary: row.primaryMember !== null,
            })),
          )
        : [];
    return {
      shifts: await this.views(rows),
      warnings: gaps.map((gap) => ({ kind: 'NO_PRIMARY' as const, ...gap })),
    };
  }

  // api-design 17. A shift that has already ended is refused (400), and so is one longer than 31 days.
  async create(
    organizationId: string,
    input: ShiftInput,
    caller: Caller,
    now: Date = new Date(),
  ): Promise<{ shift: ShiftView; warnings: RosterWarning[] }> {
    this.assertOwn(organizationId, caller);
    assertWindow(input.startsAt, input.endsAt, now, false);
    const primaryId = input.primaryMemberId ?? null;
    const backupId = input.backupMemberId ?? null;
    if (primaryId !== null && primaryId === backupId) throw notEligible();
    return this.write(async (tx) => {
      await this.lockManageable(organizationId, tx);
      await this.assertEligible(organizationId, [primaryId, backupId], tx);
      if (await this.roster.overlaps(organizationId, input.startsAt, input.endsAt, null, tx)) {
        throw overlap();
      }
      const saved = await this.roster.insertShift(
        {
          organizationId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          primaryMemberId: primaryId,
          backupMemberId: backupId,
          createdById: caller.id,
        },
        tx,
      );
      this.audit(caller, organizationId, 'roster.shiftCreated', saved.id, null, snapshot(saved));
      return this.saved(saved);
    });
  }

  // api-design 18. On a shift that has started only `endsAt` may change, and not to a time before now
  // (ruling 2026-10-30); a field sent with its current value is not a change.
  async update(
    organizationId: string,
    shiftId: string,
    patch: ShiftPatch,
    caller: Caller,
    now: Date = new Date(),
  ): Promise<{ shift: ShiftView; warnings: RosterWarning[] }> {
    this.assertOwn(organizationId, caller);
    return this.write(async (tx) => {
      await this.lockManageable(organizationId, tx);
      const current = await this.roster.findShift(organizationId, shiftId, tx);
      if (!current) throw notFound('Shift');

      const next = {
        startsAt: patch.startsAt ?? current.startsAt,
        endsAt: patch.endsAt ?? current.endsAt,
        primaryId: patch.primaryMemberId === undefined ? undefined : patch.primaryMemberId,
        backupId: patch.backupMemberId === undefined ? undefined : patch.backupMemberId,
      };
      const startChanged = next.startsAt.getTime() !== current.startsAt.getTime();
      const endChanged = next.endsAt.getTime() !== current.endsAt.getTime();
      const primaryChanged =
        next.primaryId !== undefined && next.primaryId !== (current.primaryMember?.id ?? null);
      const backupChanged =
        next.backupId !== undefined && next.backupId !== (current.backupMember?.id ?? null);

      const started = current.startsAt.getTime() <= now.getTime();
      if (started && (startChanged || primaryChanged || backupChanged)) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.SHIFT_STARTED,
          'Only the end of a started shift can change.',
        );
      }
      if (!startChanged && !endChanged && !primaryChanged && !backupChanged) {
        return this.saved(current);
      }
      assertWindow(next.startsAt, next.endsAt, now, started);

      const finalPrimary = primaryChanged
        ? (next.primaryId ?? null)
        : (current.primaryMember?.id ?? null);
      const finalBackup = backupChanged
        ? (next.backupId ?? null)
        : (current.backupMember?.id ?? null);
      if (finalPrimary !== null && finalPrimary === finalBackup) throw notEligible();
      await this.assertEligible(
        organizationId,
        [primaryChanged ? finalPrimary : null, backupChanged ? finalBackup : null],
        tx,
      );
      if (
        (startChanged || endChanged) &&
        (await this.roster.overlaps(organizationId, next.startsAt, next.endsAt, current.id, tx))
      ) {
        throw overlap();
      }

      const saved = await this.roster.updateShift(
        current.id,
        {
          ...(startChanged ? { startsAt: next.startsAt } : {}),
          ...(endChanged ? { endsAt: next.endsAt } : {}),
          ...(primaryChanged ? { primaryMemberId: finalPrimary } : {}),
          ...(backupChanged ? { backupMemberId: finalBackup } : {}),
        },
        tx,
      );
      this.audit(
        caller,
        organizationId,
        'roster.shiftChanged',
        saved.id,
        snapshot(current),
        snapshot(saved),
      );
      return this.saved(saved);
    });
  }

  // api-design 19. A started shift is kept, so the record of who was on duty stays; it is shortened
  // through `update` instead.
  async remove(
    organizationId: string,
    shiftId: string,
    caller: Caller,
    now: Date = new Date(),
  ): Promise<void> {
    this.assertOwn(organizationId, caller);
    await this.write(async (tx) => {
      await this.lockManageable(organizationId, tx);
      const current = await this.roster.findShift(organizationId, shiftId, tx);
      if (!current) throw notFound('Shift');
      if (current.startsAt.getTime() <= now.getTime()) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.SHIFT_STARTED,
          'Shorten a started shift instead of deleting it.',
        );
      }
      await this.roster.deleteShift(current.id, tx);
      this.audit(caller, organizationId, 'roster.shiftDeleted', current.id, snapshot(current), {
        shiftId: current.id,
      });
    });
  }

  // A Manager or Operator reads, and a Manager writes, their own organization only; another one
  // answers 404, as it does for every read of the module.
  private assertOwn(organizationId: string, caller: Caller): void {
    if (caller.organizationId !== organizationId) throw notFound('Organization');
  }

  private async write<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.events.transaction(work);
    } catch (error) {
      if (isOverlapViolation(error)) throw overlap();
      throw error;
    }
  }

  // Locks the organization row, which puts every roster write of the organization in a line, and
  // refuses a status that does not allow them (MSG28).
  private async lockManageable(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const organization = await this.organizations.lockById(organizationId, tx);
    if (!organization) throw notFound('Organization');
    if (!MANAGEABLE.has(organization.status)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        `This cannot be done while it is ${organization.status}.`,
      );
    }
  }

  // Every member id given is a member of the organization, not deactivated, whose account has set its
  // password (a pending invitation cannot answer an alert).
  private async assertEligible(
    organizationId: string,
    memberIds: readonly (string | null)[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const ids = [...new Set(memberIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return;
    const members = await this.roster.liveMembers(organizationId, ids, tx);
    if (members.length !== ids.length) throw notEligible();
    const cards = await this.accounts.contactCard(members.map((member) => member.userId));
    const active = new Set(cards.filter((card) => card.isActive).map((card) => card.id));
    if (members.some((member) => !active.has(member.userId))) throw notEligible();
  }

  private async saved(row: ShiftRow): Promise<{ shift: ShiftView; warnings: RosterWarning[] }> {
    const [shift] = await this.views([row]);
    const warnings: RosterWarning[] = [];
    if (!row.primaryMember)
      warnings.push({ kind: 'NO_PRIMARY', from: row.startsAt, to: row.endsAt });
    if (!row.backupMember) warnings.push({ kind: 'NO_BACKUP' });
    return { shift, warnings };
  }

  private async views(rows: readonly ShiftRow[]): Promise<ShiftView[]> {
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.primaryMember?.userId, row.backupMember?.userId])
          .filter(isString),
      ),
    ];
    const cards = await this.accounts.contactCard(userIds);
    const nameOf = new Map(cards.map((card) => [card.id, card.fullName]));
    const person = (member: ShiftRow['primaryMember']) =>
      member ? { memberId: member.id, fullName: nameOf.get(member.userId) ?? '' } : null;
    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      primary: person(row.primaryMember),
      backup: person(row.backupMember),
    }));
  }

  private audit(
    actor: Caller,
    organizationId: string,
    action: string,
    shiftId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId,
      action,
      subjectType: 'RosterShift',
      subjectId: shiftId,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}

const isString = (value: string | undefined): value is string => value !== undefined;

const snapshot = (row: ShiftRow): Record<string, unknown> => ({
  shiftId: row.id,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  primaryMemberId: row.primaryMember?.id ?? null,
  backupMemberId: row.backupMember?.id ?? null,
});

// The window of a shift: it ends after it starts, lasts at most 31 days, and has not ended. A started
// shift may be ended at this very moment (`allowEndNow`); a new or unstarted one must end later.
function assertWindow(startsAt: Date, endsAt: Date, now: Date, allowEndNow: boolean): void {
  if (endsAt.getTime() <= startsAt.getTime()) throw invalid('endsAt must be after startsAt.');
  const ended = allowEndNow ? endsAt.getTime() < now.getTime() : endsAt.getTime() <= now.getTime();
  if (ended) throw invalid('endsAt must not be in the past.');
  if (endsAt.getTime() - startsAt.getTime() > MAX_SPAN_MS) {
    throw invalid('A shift lasts at most 31 days.');
  }
}
