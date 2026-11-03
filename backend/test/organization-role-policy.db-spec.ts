import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AccountType,
  MemberRole,
  OrganizationRoleEffect,
  OrganizationStatus,
  Prisma,
} from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { AbilityFactory } from '../src/modules/auth/casl/ability.factory';
import { POLICY_CHANGED, PermissionCache } from '../src/modules/auth/casl/permission-cache';
import { OrganizationRolePolicyRepository } from '../src/modules/auth/organization-role-policy.repository';
import { OrganizationRolePolicyService } from '../src/modules/auth/organization-role-policy.service';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The per-organization role policy against Postgres (auth tasks 9.1 to 9.4, D-095, AC-07, AC-10): the
// rows of a grant and a revoke, the effective set of two organizations that start from one baseline,
// a refused save that leaves no row, and two saves for one role of which one loses. Run only through
// test:db against a migrated disposable database. Fixtures carry a fresh run ID and are never deleted.
describe('Organization role policy against Postgres (D-095)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const accounts = new AccountsRepository(prisma);
  const policies = new OrganizationRolePolicyRepository(prisma);
  const parameters = { get: () => Promise.resolve(30) } as unknown as ParameterService;
  const cache = new PermissionCache(accounts, policies, parameters);
  const abilities = new AbilityFactory(cache);
  const membership = new Map<string, { organizationId: string; organizationStatus: string }>();
  const organizationsRepository = new OrganizationsRepository(prisma);
  const context = {
    forUser: (userId: string) => Promise.resolve(membership.get(userId) ?? null),
    // The real locked read of `organizations`, so the status gate runs against Postgres.
    lockOrganizationStatus: (organizationId: string, tx: Prisma.TransactionClient) =>
      organizationsRepository.lockStatus(organizationId, tx),
  };
  const service = new OrganizationRolePolicyService(accounts, policies, events, context as never);
  const runId = randomUUID();
  let serial = 0;
  const CLIENT = { ip: '127.0.0.1', userAgent: 'jest' };

  // An ACTIVE organization with a Manager and an Operator, as the callers of the service and the
  // contexts of the ability factory.
  const organization = async (status: OrganizationStatus = OrganizationStatus.ACTIVE) => {
    serial += 1;
    const org = await prisma.organization.create({
      data: {
        code: `RP-${runId.slice(0, 8)}-${serial}`,
        legalName: `Role policy test ${serial}`,
        taxCode: `RP${runId}-${serial}`,
        address: '1 Test Street',
        contactEmail: `role-policy-${runId}-${serial}@example.invalid`,
        contactPhone: '0900000000',
        status,
      },
    });
    const person = async (role: MemberRole): Promise<Caller> => {
      serial += 1;
      const key = role === MemberRole.MANAGER ? 'ORG_MANAGER' : 'ORG_OPERATOR';
      const user = await accounts.create({
        email: `role-policy-${runId}-${serial}@example.invalid`,
        fullName: `Role policy member ${serial}`,
        accountType: AccountType.ORGANIZATION,
        roleKeys: [key],
      });
      await prisma.organizationMember.create({
        data: { userId: user.id, organizationId: org.id, role },
      });
      membership.set(user.id, { organizationId: org.id, organizationStatus: status });
      return { id: user.id, roles: [key], organizationId: org.id };
    };
    return {
      org,
      manager: await person(MemberRole.MANAGER),
      operator: await person(MemberRole.OPERATOR),
    };
  };

  const can = async (caller: Caller, action: string, subject: string) =>
    (
      await abilities.forContext({
        userId: caller.id,
        organizationId: caller.organizationId,
        roles: caller.roles,
      })
    ).can(action, subject);

  const operatorKeys = async (manager: Caller) =>
    (await service.view(manager)).roles.find((role) => role.key === 'ORG_OPERATOR')!;

  beforeAll(async () => {
    await prisma.$connect();
    emitter.on(POLICY_CHANGED, (event: { organizationId?: string }) => cache.invalidate(event));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stores a grant and a revoke and reads them back as permission keys, with the version', async () => {
    const { org, manager } = await organization();
    const operator = await operatorKeys(manager);
    const keys = operator.effectiveKeys.filter((key) => key !== 'incident.respond.own');
    await service.replace(manager, 'ORG_OPERATOR', [...keys, 'member.manage.own'], 0, CLIENT);

    const stored = await policies.findStored(org.id, 'ORG_OPERATOR');

    expect(stored.version).toBe(1);
    expect(stored.revokes).toEqual(['incident.respond.own']);
    expect(stored.grants).toEqual(['member.manage.own']);
    const rows = await prisma.organizationRolePermission.findMany({
      where: { organizationId: org.id },
    });
    expect(rows.map((row) => row.effect).sort()).toEqual([
      OrganizationRoleEffect.GRANT,
      OrganizationRoleEffect.REVOKE,
    ]);
  });

  it('applies a revoke to the Operator of one organization only and leaves its Manager untouched (AC-07, AC-10)', async () => {
    const a = await organization();
    const b = await organization();
    expect(await can(a.operator, 'respond', 'Incident')).toBe(true);

    const keys = (await operatorKeys(a.manager)).effectiveKeys.filter(
      (key) => key !== 'incident.respond.own',
    );
    await service.replace(a.manager, 'ORG_OPERATOR', keys, 0, CLIENT);

    expect(await can(a.operator, 'respond', 'Incident')).toBe(false);
    expect(await can(a.operator, 'read', 'Incident')).toBe(true);
    expect(await can(a.manager, 'respond', 'Incident')).toBe(true);
    expect(await can(b.operator, 'respond', 'Incident')).toBe(true);
    expect(await can(b.manager, 'respond', 'Incident')).toBe(true);
  });

  it('grants the Operator a permission inside the ceiling, in that organization only', async () => {
    const a = await organization();
    const b = await organization();
    expect(await can(a.operator, 'manage', 'Member')).toBe(false);

    const keys = (await operatorKeys(a.manager)).effectiveKeys;
    await service.replace(a.manager, 'ORG_OPERATOR', [...keys, 'member.manage.own'], 0, CLIENT);

    expect(await can(a.operator, 'manage', 'Member')).toBe(true);
    expect(await can(b.operator, 'manage', 'Member')).toBe(false);
  });

  it('leaves no policy row behind when a save is refused (stale version, lockout)', async () => {
    const { org, manager } = await organization();
    const keys = (await operatorKeys(manager)).effectiveKeys;

    await expect(service.replace(manager, 'ORG_OPERATOR', keys, 7, CLIENT)).rejects.toMatchObject({
      errorCode: ErrorCode.STALE_VERSION,
    });
    await expect(
      service.replace(manager, 'ORG_MANAGER', ['member.manage.own'], 0, CLIENT),
    ).rejects.toMatchObject({ errorCode: ErrorCode.MANAGER_LOCKOUT });

    expect(await prisma.organizationRolePolicy.count({ where: { organizationId: org.id } })).toBe(
      0,
    );
  });

  it('refuses a save while the organization is not ACTIVE and reads while it is', async () => {
    const { manager } = await organization(OrganizationStatus.SUSPENDED);

    await expect(
      service.replace(manager, 'ORG_OPERATOR', ['incident.read.own'], 0, CLIENT),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE });
    await expect(service.view(manager)).resolves.toHaveProperty('roles');
  });

  it('refuses a save when the organization was suspended after the first status read (REQ-STA-04)', async () => {
    const { org, manager } = await organization();
    const keys = (await operatorKeys(manager)).effectiveKeys;
    // The membership read before the transaction still says ACTIVE; the row says SUSPENDED.
    await prisma.organization.update({
      where: { id: org.id },
      data: { status: OrganizationStatus.SUSPENDED },
    });

    await expect(service.replace(manager, 'ORG_OPERATOR', keys, 0, CLIENT)).rejects.toMatchObject({
      errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
    });
    expect(await prisma.organizationRolePolicy.count({ where: { organizationId: org.id } })).toBe(
      0,
    );
  });

  it('makes a save wait for a suspension in flight and then refuses it', async () => {
    const { org, manager } = await organization();
    const keys = (await operatorKeys(manager)).effectiveKeys;
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A suspension as OrganizationLifecycle writes it: the row FOR UPDATE until it commits.
    const suspending = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${org.id} FOR UPDATE`;
      await tx.organization.update({
        where: { id: org.id },
        data: { status: OrganizationStatus.SUSPENDED },
      });
      await gate;
    });
    await pause(300);

    let settled = false;
    const saving = service.replace(manager, 'ORG_OPERATOR', keys, 0, CLIENT);
    saving.then(
      () => (settled = true),
      () => (settled = true),
    );
    await pause(300);
    expect(settled).toBe(false);

    release();
    await suspending;
    await expect(saving).rejects.toMatchObject({ errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE });
  });

  it('lets one of two concurrent saves for the same role win and refuses the other with STALE_VERSION', async () => {
    const { org, manager } = await organization();
    const keys = (await operatorKeys(manager)).effectiveKeys;

    const results = await Promise.allSettled([
      service.replace(
        manager,
        'ORG_OPERATOR',
        keys.filter((key) => key !== 'incident.respond.own'),
        0,
        CLIENT,
      ),
      service.replace(
        manager,
        'ORG_OPERATOR',
        keys.filter((key) => key !== 'incident.read.own'),
        0,
        CLIENT,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect((refused.reason as { errorCode: string }).errorCode).toBe(ErrorCode.STALE_VERSION);
    expect((await policies.findStored(org.id, 'ORG_OPERATOR')).version).toBe(1);
  });
});
