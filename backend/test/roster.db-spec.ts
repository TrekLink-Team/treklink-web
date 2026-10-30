import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, MemberRole, OrganizationStatus } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { OneTimeCodeService } from '../src/modules/auth/one-time-code.service';
import { PasswordFlowsService } from '../src/modules/auth/password-flows.service';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { RosterRepository } from '../src/modules/organizations/roster.repository';
import { ShiftsService } from '../src/modules/organizations/shifts.service';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import { ConfigService } from '@nestjs/config';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The on-duty roster against Postgres (organizations task 2.6, AC-04): overlap refused by the check and
// by the database constraint, two creates racing for one window, the started-shift rules, and the
// members a shift may name. Run only through test:db against a migrated disposable database. Fixtures
// carry a fresh run ID and are never deleted.
describe('Roster shifts against Postgres (REQ-UBI-04, FR-ORG-05, AC-04)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const events = new TransactionalEvents(prisma, new EventEmitter2());
  const accountsRepository = new AccountsRepository(prisma);
  const parameters = {
    get: (key: string) => Promise.resolve(key === 'auth.invitationTtlHours' ? 72 : 10),
  } as unknown as ParameterService;
  const codes = new OneTimeCodeService(accountsRepository, parameters);
  const mail = { sendCode: () => Promise.resolve() } as unknown as PasswordFlowsService;
  const config = {
    get: (key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100),
  } as unknown as ConfigService<ValidatedEnvironment, true>;
  const accounts = new AccountsService(accountsRepository, codes, mail, events, config);
  const service = new ShiftsService(
    new RosterRepository(prisma),
    new OrganizationsRepository(prisma),
    accounts,
    events,
    { get: () => Promise.resolve(31) } as unknown as ParameterService,
  );
  const runId = randomUUID();
  const hour = 3_600_000;
  const base = Date.now() + 24 * hour;
  const at = (hours: number) => new Date(base + hours * hour);
  let serial = 0;

  // An ACTIVE organization with a Manager and two Operators; `pending` leaves the second Operator without
  // a password. Returns the member ids and the Manager as a caller.
  const organization = async () => {
    serial += 1;
    const org = await prisma.organization.create({
      data: {
        code: `R-${runId.slice(0, 8)}-${serial}`,
        legalName: `Roster test ${serial}`,
        taxCode: `R${runId}-${serial}`,
        address: '1 Test Street',
        contactEmail: `roster-test-${runId}-${serial}@example.invalid`,
        contactPhone: '0900000000',
        status: OrganizationStatus.ACTIVE,
      },
    });
    const member = async (role: MemberRole, passwordSet: boolean) => {
      serial += 1;
      const user = await accountsRepository.create({
        email: `roster-test-${runId}-${serial}@example.invalid`,
        fullName: `Roster test ${serial}`,
        accountType: AccountType.ORGANIZATION,
        roleKeys: [role === MemberRole.MANAGER ? 'ORG_MANAGER' : 'ORG_OPERATOR'],
      });
      // An invited account is created active; it has no password until its holder sets one.
      if (passwordSet) {
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'test-hash' } });
      }
      const row = await prisma.organizationMember.create({
        data: { userId: user.id, organizationId: org.id, role },
      });
      return { id: row.id, userId: user.id };
    };
    const manager = await member(MemberRole.MANAGER, true);
    const a = await member(MemberRole.OPERATOR, true);
    const b = await member(MemberRole.OPERATOR, true);
    const pending = await member(MemberRole.OPERATOR, false);
    const caller: Caller = { id: manager.userId, roles: ['ORG_MANAGER'], organizationId: org.id };
    return { org, manager, a, b, pending, caller };
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuses an overlapping shift with 409 SHIFT_OVERLAP and accepts one that only touches', async () => {
    const { org, a, caller } = await organization();
    await service.create(org.id, { startsAt: at(0), endsAt: at(8), primaryMemberId: a.id }, caller);

    await expect(
      service.create(org.id, { startsAt: at(4), endsAt: at(12), primaryMemberId: a.id }, caller),
    ).rejects.toMatchObject({ errorCode: ErrorCode.SHIFT_OVERLAP });
    await expect(
      service.create(org.id, { startsAt: at(8), endsAt: at(16), primaryMemberId: a.id }, caller),
    ).resolves.toMatchObject({ shift: { startsAt: at(8) } });
  });

  it('lets only one of two concurrent creates for one window pass', async () => {
    const { org, a, b, caller } = await organization();

    const results = await Promise.allSettled([
      service.create(org.id, { startsAt: at(0), endsAt: at(8), primaryMemberId: a.id }, caller),
      service.create(org.id, { startsAt: at(2), endsAt: at(10), primaryMemberId: b.id }, caller),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { errorCode: ErrorCode.SHIFT_OVERLAP },
    });
    expect(await prisma.rosterShift.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it('is guarded by the database too: the exclusion constraint names itself in its error', async () => {
    const { org, a, manager } = await organization();
    const shift = (startsAt: Date, endsAt: Date) =>
      prisma.rosterShift.create({
        data: {
          organizationId: org.id,
          startsAt,
          endsAt,
          primaryMemberId: a.id,
          createdById: manager.userId,
        },
      });
    await shift(at(0), at(8));

    await expect(shift(at(4), at(12))).rejects.toThrow(/roster_shifts_no_overlap|23P01/);
  });

  it('refuses a member who is deactivated, has no password yet, or is in both slots (MEMBER_NOT_ELIGIBLE)', async () => {
    const { org, a, pending, caller } = await organization();
    await prisma.organizationMember.update({
      where: { id: a.id },
      data: { deactivatedAt: new Date() },
    });

    for (const slots of [
      { primaryMemberId: a.id },
      { primaryMemberId: pending.id },
      { primaryMemberId: pending.id, backupMemberId: pending.id },
    ]) {
      await expect(
        service.create(org.id, { startsAt: at(0), endsAt: at(8), ...slots }, caller),
      ).rejects.toMatchObject({ errorCode: ErrorCode.MEMBER_NOT_ELIGIBLE });
    }
    expect(await prisma.rosterShift.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('lets only the end of a started shift change, and keeps a started shift from being deleted', async () => {
    const { org, a, b, manager, caller } = await organization();
    const started = await prisma.rosterShift.create({
      data: {
        organizationId: org.id,
        startsAt: new Date(Date.now() - hour),
        endsAt: new Date(Date.now() + 2 * hour),
        primaryMemberId: a.id,
        createdById: manager.userId,
      },
    });

    await expect(
      service.update(org.id, started.id, { primaryMemberId: b.id }, caller),
    ).rejects.toMatchObject({ errorCode: ErrorCode.SHIFT_STARTED });
    await expect(
      service.update(org.id, started.id, { endsAt: new Date(Date.now() - 60_000) }, caller),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    const later = new Date(Date.now() + 5 * hour);
    await expect(
      service.update(org.id, started.id, { endsAt: later }, caller),
    ).resolves.toMatchObject({ shift: { endsAt: later } });
    await expect(service.remove(org.id, started.id, caller)).rejects.toMatchObject({
      errorCode: ErrorCode.SHIFT_STARTED,
    });
    expect(await prisma.rosterShift.count({ where: { id: started.id } })).toBe(1);
  });

  it('edits and deletes a shift that has not started, and answers 404 for another organization', async () => {
    const { org, a, b, caller } = await organization();
    const other = await organization();
    const { shift } = await service.create(
      org.id,
      { startsAt: at(0), endsAt: at(8), primaryMemberId: a.id },
      caller,
    );

    await expect(
      service.update(org.id, shift.id, { backupMemberId: b.id, endsAt: at(10) }, caller),
    ).resolves.toMatchObject({ shift: { backup: { memberId: b.id } }, warnings: [] });
    await expect(service.remove(other.org.id, shift.id, other.caller)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.remove(org.id, shift.id, caller)).resolves.toBeUndefined();
    expect(await prisma.rosterShift.count({ where: { id: shift.id } })).toBe(0);
  });

  it('lists the shifts of the window with a NO_PRIMARY warning for the gap', async () => {
    const { org, a, caller } = await organization();
    await service.create(org.id, { startsAt: at(2), endsAt: at(6), primaryMemberId: a.id }, caller);

    const result = await service.list(org.id, at(0), at(10), caller, new Date(base - hour));

    expect(result.shifts).toHaveLength(1);
    expect(result.warnings).toEqual([
      { kind: 'NO_PRIMARY', from: at(0), to: at(2) },
      { kind: 'NO_PRIMARY', from: at(6), to: at(10) },
    ]);
  });
});
