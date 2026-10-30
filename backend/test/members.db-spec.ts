import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, MemberRole, OrganizationStatus } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService, MEMBER_DEACTIVATED } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { OneTimeCodeService } from '../src/modules/auth/one-time-code.service';
import { PasswordFlowsService } from '../src/modules/auth/password-flows.service';
import { MembersRepository } from '../src/modules/organizations/members.repository';
import { MembersService } from '../src/modules/organizations/members.service';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { RosterRepository } from '../src/modules/organizations/roster.repository';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Member administration against Postgres (organizations task 2.5, AC-03): the last-Manager guard
// under concurrent changes, the invitation and its rollback, and the shifts a deactivation clears.
// Run only through test:db against a migrated disposable database. Fixtures carry a fresh run ID and
// are never deleted.
describe('Members of an organization against Postgres (REQ-UBI-02, REQ-EVT-07, REQ-EVT-08)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
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
  const service = new MembersService(
    new OrganizationsRepository(prisma),
    new MembersRepository(prisma),
    new RosterRepository(prisma),
    accounts,
    events,
  );
  const runId = randomUUID();
  let serial = 0;

  // An ACTIVE organization with its members, each account activated (a password set).
  const organizationWith = async (roles: MemberRole[]) => {
    serial += 1;
    const organization = await prisma.organization.create({
      data: {
        code: `T-${runId.slice(0, 8)}-${serial}`,
        legalName: `Members test ${serial}`,
        taxCode: `T${runId}-${serial}`,
        address: '1 Test Street',
        contactEmail: `members-test-${runId}-${serial}@example.invalid`,
        contactPhone: '0900000000',
        status: OrganizationStatus.ACTIVE,
      },
    });
    const members: { id: string; userId: string; caller: Caller }[] = [];
    for (const role of roles) {
      serial += 1;
      const user = await accountsRepository.create({
        email: `members-test-${runId}-${serial}@example.invalid`,
        fullName: `Members test ${serial}`,
        accountType: AccountType.ORGANIZATION,
        roleKeys: [role === MemberRole.MANAGER ? 'ORG_MANAGER' : 'ORG_OPERATOR'],
      });
      // A member in use has set a password; an invitation waits with passwordHash null.
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: true, passwordHash: 'set-in-fixture' },
      });
      const member = await prisma.organizationMember.create({
        data: { userId: user.id, organizationId: organization.id, role },
      });
      members.push({
        id: member.id,
        userId: user.id,
        caller: {
          id: user.id,
          roles: [role === MemberRole.MANAGER ? 'ORG_MANAGER' : 'ORG_OPERATOR'],
          organizationId: organization.id,
        },
      });
    }
    return { organization, members };
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lets only one of two concurrent demotions of the last two Managers pass', async () => {
    const { organization, members } = await organizationWith([
      MemberRole.MANAGER,
      MemberRole.MANAGER,
    ]);
    const [a, b] = members;

    const results = await Promise.allSettled([
      service.changeRole(organization.id, a.id, MemberRole.OPERATOR, b.caller),
      service.changeRole(organization.id, b.id, MemberRole.OPERATOR, a.caller),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { errorCode: ErrorCode.LAST_MANAGER },
    });
    expect(
      await prisma.organizationMember.count({
        where: { organizationId: organization.id, role: MemberRole.MANAGER, deactivatedAt: null },
      }),
    ).toBe(1);
  });

  it('lets only one of a concurrent demotion and deactivation of the last two Managers pass', async () => {
    const { organization, members } = await organizationWith([
      MemberRole.MANAGER,
      MemberRole.MANAGER,
    ]);
    const [a, b] = members;

    const results = await Promise.allSettled([
      service.changeRole(organization.id, a.id, MemberRole.OPERATOR, b.caller),
      service.deactivate(organization.id, b.id, 'Concurrent', a.caller),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const managers = await prisma.organizationMember.findMany({
      where: { organizationId: organization.id, role: MemberRole.MANAGER, deactivatedAt: null },
      select: { userId: true },
    });
    expect(managers).toHaveLength(1);
    const left = await prisma.user.findUniqueOrThrow({ where: { id: managers[0].userId } });
    expect(left.isActive).toBe(true);
  });

  it('invites a member inactive with a set-password code, and refuses a taken email without a member row', async () => {
    const { organization, members } = await organizationWith([MemberRole.MANAGER]);
    const email = `invited-${runId}@example.invalid`;

    const view = await service.invite(
      organization.id,
      { email, fullName: 'Invited Operator', role: MemberRole.OPERATOR },
      members[0].caller,
    );

    expect(view).toMatchObject({ email, role: MemberRole.OPERATOR, invitationPending: true });
    const invited = await prisma.user.findUniqueOrThrow({ where: { id: view.userId } });
    // Created active, with no password until the set-password code is used.
    expect(invited.isActive).toBe(true);
    expect(invited.passwordHash).toBeNull();
    expect(await prisma.oneTimeCode.count({ where: { userId: view.userId } })).toBe(1);

    const members0 = await prisma.organizationMember.count({
      where: { organizationId: organization.id },
    });
    await expect(
      service.invite(
        organization.id,
        { email: email.toUpperCase(), fullName: 'Again', role: MemberRole.OPERATOR },
        members[0].caller,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT_UNIQUE });
    expect(
      await prisma.organizationMember.count({ where: { organizationId: organization.id } }),
    ).toBe(members0);
  });

  it('deactivates a member, clears the shifts that have not ended and emits member.deactivated after commit', async () => {
    const { organization, members } = await organizationWith([
      MemberRole.MANAGER,
      MemberRole.OPERATOR,
    ]);
    const [manager, operator] = members;
    const now = Date.now();
    const hour = 3_600_000;
    const shift = (startsAt: number, endsAt: number, slot: 'primary' | 'backup') =>
      prisma.rosterShift.create({
        data: {
          organizationId: organization.id,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          createdById: manager.userId,
          ...(slot === 'primary'
            ? { primaryMemberId: operator.id }
            : { backupMemberId: operator.id }),
        },
      });
    const ended = await shift(now - 4 * hour, now - hour, 'primary');
    const running = await shift(now - hour, now + 2 * hour, 'backup');
    const future = await shift(now + 3 * hour, now + 5 * hour, 'primary');
    const seen: unknown[] = [];
    const listener = (payload: unknown) => seen.push(payload);
    emitter.on(MEMBER_DEACTIVATED, listener);

    const view = await service.deactivate(organization.id, operator.id, 'Left', manager.caller);
    emitter.off(MEMBER_DEACTIVATED, listener);

    expect(view.deactivatedAt).toBeInstanceOf(Date);
    expect(seen).toContainEqual({ userId: operator.userId });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: operator.userId } })).isActive).toBe(
      false,
    );
    const rows = await prisma.rosterShift.findMany({
      where: { id: { in: [ended.id, running.id, future.id] } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ended.id)?.primaryMemberId).toBe(operator.id);
    expect(byId.get(running.id)?.backupMemberId).toBeNull();
    expect(byId.get(future.id)?.primaryMemberId).toBeNull();
  });
});
