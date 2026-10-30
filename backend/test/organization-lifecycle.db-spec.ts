import { randomUUID } from 'node:crypto';
import { createMongoAbility } from '@casl/ability';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AccountType,
  InvoiceKind,
  InvoiceLineType,
  MemberRole,
  OrganizationStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import { Caller, PolicyAbility } from '../src/common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService, MEMBER_DEACTIVATED } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { BalanceService } from '../src/modules/billing/balance.service';
import { DamageChargesRepository } from '../src/modules/billing/damage-charges.repository';
import { InvoicesRepository } from '../src/modules/billing/invoices.repository';
import { BillingOrganizationExitCheck } from '../src/modules/billing/providers/organization-exit-check.provider';
import { OneTimeCodeService } from '../src/modules/auth/one-time-code.service';
import { PasswordFlowsService } from '../src/modules/auth/password-flows.service';
import { API_KEY_REVOKED } from '../src/modules/organizations/api-key-events';
import { ApiKeysRepository } from '../src/modules/organizations/api-keys.repository';
import { FIELD_STATION_REVOKED } from '../src/modules/organizations/field-station-events';
import { FieldStationsRepository } from '../src/modules/organizations/field-stations.repository';
import { MembersRepository } from '../src/modules/organizations/members.repository';
import { OrganizationLifecycle } from '../src/modules/organizations/organization-lifecycle';
import { OrganizationStatusService } from '../src/modules/organizations/organization-status.service';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { OrganizationsService } from '../src/modules/organizations/organizations.service';
import { OrganizationExitCheck } from '../src/modules/organizations/ports/exit-checks.port';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The organization lifecycle against Postgres (organizations tasks 1.2 and 2.4, REQ-UBI-01, REQ-EVT-04
// to REQ-EVT-06): one transition row per change, a closing that deactivates the members and revokes
// the keys and stations in one transaction (and rolls back with it), the version compare under two
// Admins, and the checks other modules add. Run only through test:db against a migrated disposable
// database. Fixtures carry a fresh run ID and are never deleted.
describe('Organization lifecycle against Postgres (REQ-UBI-01, REQ-EVT-04, REQ-EVT-05, REQ-EVT-06)', () => {
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
  const organizationsRepository = new OrganizationsRepository(prisma);
  const members = new MembersRepository(prisma);
  const apiKeys = new ApiKeysRepository(prisma);
  const stations = new FieldStationsRepository(prisma);
  const lifecycle = new OrganizationLifecycle(organizationsRepository, events);
  const organizationsService = new OrganizationsService(
    organizationsRepository,
    members,
    accounts,
    lifecycle,
  );
  const checks: OrganizationExitCheck[] = [];
  const service = new OrganizationStatusService(
    lifecycle,
    organizationsRepository,
    organizationsService,
    members,
    apiKeys,
    stations,
    accounts,
    events,
    checks,
  );
  // Staff and Admin read any organization's history; the ability is consulted only for a member.
  const staffAbility = createMongoAbility([
    { action: 'read', subject: 'Organization' },
  ]) as unknown as PolicyAbility;
  const runId = randomUUID();
  let serial = 0;

  const admin = async (): Promise<Caller> => {
    serial += 1;
    const user = await accountsRepository.create({
      email: `lifecycle-admin-${runId}-${serial}@example.invalid`,
      fullName: `Lifecycle Admin ${serial}`,
      accountType: AccountType.TREKLINK,
      roleKeys: ['ADMIN'],
    });
    return { id: user.id, roles: ['ADMIN'], organizationId: null };
  };

  // An ACTIVE organization with a Manager and an Operator who have set their passwords, one API key
  // and one Field Station.
  const organization = async (admin1: Caller) => {
    serial += 1;
    const org = await prisma.organization.create({
      data: {
        code: `L-${runId.slice(0, 8)}-${serial}`,
        legalName: `Lifecycle test ${serial}`,
        taxCode: `L${runId}-${serial}`,
        address: '1 Test Street',
        contactEmail: `lifecycle-test-${runId}-${serial}@example.invalid`,
        contactPhone: '0900000000',
        status: OrganizationStatus.ACTIVE,
      },
    });
    const people: { id: string; userId: string }[] = [];
    for (const role of [MemberRole.MANAGER, MemberRole.OPERATOR]) {
      serial += 1;
      const user = await accountsRepository.create({
        email: `lifecycle-member-${runId}-${serial}@example.invalid`,
        fullName: `Lifecycle member ${serial}`,
        accountType: AccountType.ORGANIZATION,
        roleKeys: [role === MemberRole.MANAGER ? 'ORG_MANAGER' : 'ORG_OPERATOR'],
      });
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'test-hash' } });
      const member = await prisma.organizationMember.create({
        data: { userId: user.id, organizationId: org.id, role },
      });
      people.push({ id: member.id, userId: user.id });
    }
    const key = await prisma.apiKey.create({
      data: {
        organizationId: org.id,
        name: 'ERP integration',
        prefix: 'tlk_test',
        keyHash: `hash-${runId}-${serial}`,
        createdById: people[0].userId,
      },
    });
    const station = await prisma.fieldStation.create({
      data: {
        organizationId: org.id,
        name: 'Ta Nang laptop',
        mqttUsername: `fs-${org.code.toLowerCase()}-1`,
        secretHash: 'test-hash',
        createdById: people[0].userId,
      },
    });
    return { org, people, key, station, admin: admin1 };
  };

  const read = (id: string) => prisma.organization.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(() => {
    checks.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('closes an organization: members deactivated, keys and stations revoked, one transition, each listener told', async () => {
    const root = await admin();
    const { org, people, key, station } = await organization(root);
    const seen: [string, unknown][] = [];
    const record = (name: string) => (payload: unknown) => seen.push([name, payload]);
    const listeners = [MEMBER_DEACTIVATED, API_KEY_REVOKED, FIELD_STATION_REVOKED].map((name) => {
      const listener = record(name);
      emitter.on(name, listener);
      return [name, listener] as const;
    });

    const closed = await service.close(org.id, 'Customer request', org.version, root);
    listeners.forEach(([name, listener]) => emitter.off(name, listener));

    expect(closed).toMatchObject({ status: OrganizationStatus.CLOSED, version: org.version + 1 });
    for (const person of people) {
      const member = await prisma.organizationMember.findUniqueOrThrow({
        where: { id: person.id },
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: person.userId } });
      expect(member.deactivatedAt).toBeInstanceOf(Date);
      expect(user.isActive).toBe(false);
    }
    expect(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt,
    ).toBeInstanceOf(Date);
    expect(
      (await prisma.fieldStation.findUniqueOrThrow({ where: { id: station.id } })).revokedAt,
    ).toBeInstanceOf(Date);
    const history = await prisma.organizationTransition.findMany({
      where: { organizationId: org.id },
    });
    expect(history).toEqual([
      expect.objectContaining({
        fromStatus: OrganizationStatus.ACTIVE,
        toStatus: OrganizationStatus.CLOSED,
        actorId: root.id,
        reason: 'Customer request',
      }),
    ]);
    expect(seen.filter(([name]) => name === MEMBER_DEACTIVATED)).toHaveLength(2);
    expect(seen).toContainEqual([API_KEY_REVOKED, { organizationId: org.id, apiKeyId: key.id }]);
    expect(seen).toContainEqual([
      FIELD_STATION_REVOKED,
      { organizationId: org.id, fieldStationId: station.id, mqttUsername: station.mqttUsername },
    ]);
  });

  it('rolls the whole closing back when a step after the status change fails', async () => {
    const root = await admin();
    const { org, people, key } = await organization(root);
    const failing = jest
      .spyOn(stations, 'revokeAllActive')
      .mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.close(org.id, 'Customer request', org.version, root)).rejects.toThrow(
      'connection lost',
    );
    failing.mockRestore();

    expect((await read(org.id)).status).toBe(OrganizationStatus.ACTIVE);
    expect(await prisma.organizationTransition.count({ where: { organizationId: org.id } })).toBe(
      0,
    );
    for (const person of people) {
      const member = await prisma.organizationMember.findUniqueOrThrow({
        where: { id: person.id },
      });
      expect(member.deactivatedAt).toBeNull();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: person.userId } })).isActive).toBe(
        true,
      );
    }
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).toBeNull();
  });

  it('refuses a closing while a check reports an open contract, and changes nothing', async () => {
    const root = await admin();
    const { org, people } = await organization(root);
    checks.push({
      canReactivate: () => Promise.resolve(null),
      canClose: () =>
        Promise.resolve({
          code: 'OPEN_CONTRACTS',
          message: 'This cannot be done while it has open contracts.',
        }),
    });

    await expect(
      service.close(org.id, 'Customer request', org.version, root),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.OPEN_CONTRACTS,
    });

    expect((await read(org.id)).status).toBe(OrganizationStatus.ACTIVE);
    const member = await prisma.organizationMember.findUniqueOrThrow({
      where: { id: people[0].id },
    });
    expect(member.deactivatedAt).toBeNull();
  });

  it('suspends and reactivates, writing a transition each, with the reason kept while suspended', async () => {
    const root = await admin();
    const { org } = await organization(root);

    const suspended = await service.suspend(org.id, 'Unpaid balance', org.version, root);
    expect(suspended).toMatchObject({ status: OrganizationStatus.SUSPENDED });
    expect((await read(org.id)).suspensionReason).toBe('Unpaid balance');

    checks.push({
      canReactivate: () =>
        Promise.resolve({
          code: 'BALANCE_OUTSTANDING',
          message: 'This cannot be done while it has open balances.',
        }),
      canClose: () => Promise.resolve(null),
    });
    await expect(service.reactivate(org.id, suspended.version, root)).rejects.toMatchObject({
      errorCode: ErrorCode.BALANCE_OUTSTANDING,
    });
    expect((await read(org.id)).status).toBe(OrganizationStatus.SUSPENDED);

    checks.length = 0;
    await expect(service.reactivate(org.id, suspended.version, root)).resolves.toMatchObject({
      status: OrganizationStatus.ACTIVE,
    });
    expect((await read(org.id)).suspensionReason).toBeNull();

    const history = await service.transitions(org.id, root, staffAbility);
    expect(history.map((row) => `${row.fromStatus}>${row.toStatus}`)).toEqual([
      'ACTIVE>SUSPENDED',
      'SUSPENDED>ACTIVE',
    ]);
    expect(history[0]).toMatchObject({
      actor: expect.stringContaining('Lifecycle Admin') as unknown,
      reason: 'Unpaid balance',
    });
  });

  // The real billing reactivation check (billing task 1.3) over one invoiced contract of a suspended
  // organization: a TERM invoice with a paid holding fee and the given further lines.
  const invoiced = async (
    lines: { type: InvoiceLineType; amountVnd: bigint; paidVnd: bigint; dueAt: Date }[],
  ) => {
    const root = await admin();
    const { org, people } = await organization(root);
    new BillingOrganizationExitCheck(
      new BalanceService(new InvoicesRepository(prisma), new DamageChargesRepository(prisma)),
      checks,
    );
    serial += 1;
    const tag = `${runId.slice(0, 8)}-${serial}`;
    const variant = await prisma.hardwareVariant.create({
      data: {
        code: `lifecycle-test-${tag}`,
        name: 'Lifecycle test variant',
        hasGps: true,
        hasMotionSensor: false,
        mqttCapable: true,
        firmwareBaseline: 'test-only',
        remainingValueSchedule: [],
      },
    });
    const device = await prisma.device.create({
      data: {
        assetTag: `lifecycle-test-${tag}`,
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variant.id,
        firmwareVersion: 'test-only',
        acquiredAt: new Date('2026-10-01T00:00:00.000Z'),
        registeredById: root.id,
      },
    });
    const contract = await prisma.rentalContract.create({
      data: {
        code: `RC-L-${tag}`,
        organizationId: org.id,
        planType: PlanType.MONTHLY,
        hardwareVariantId: variant.id,
        quantity: 1,
        requestedStartDate: new Date('2026-10-01T00:00:00.000Z'),
        monthlyUnitPriceVnd: 250_000n,
        holdingFeeRatio: new Prisma.Decimal('0.5'),
        requestedById: people[0].userId,
      },
    });
    const all = [
      {
        type: InvoiceLineType.HOLDING_FEE,
        amountVnd: 125_000n,
        paidVnd: 125_000n,
        dueAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      ...lines,
    ];
    await prisma.invoice.create({
      data: {
        number: `INV-L-${tag}`,
        organizationId: org.id,
        contractId: contract.id,
        kind: InvoiceKind.TERM,
        totalVnd: all.reduce((total, line) => total + line.amountVnd, 0n),
        paidVnd: all.reduce((total, line) => total + line.paidVnd, 0n),
        lines: {
          create: all.map((line, index) => ({
            ...line,
            seq: index + 1,
            description: line.type,
            unitVnd: line.amountVnd,
          })),
        },
      },
    });
    const suspended = await service.suspend(org.id, 'Unpaid balance', org.version, root);
    return { root, org, device, contract, suspended };
  };

  // Leader ruling 2026-10-30 (REQ-EVT-05, REQ-ERR-04): reactivation counts only lines due at or before
  // the reactivation time and unpaid. A second installment due later does not block it.
  describe('reactivation counts only due and unpaid lines (leader ruling 2026-10-30)', () => {
    const reactivatedAt = new Date('2026-10-30T03:00:00.000Z');

    it('reactivates a suspended organization whose only unpaid line is a future installment', async () => {
      const { root, org, suspended } = await invoiced([
        {
          type: InvoiceLineType.TERM_BALANCE,
          amountVnd: 125_000n,
          paidVnd: 0n,
          dueAt: new Date('2026-11-30T02:00:00.000Z'),
        },
      ]);

      await expect(
        service.reactivate(org.id, suspended.version, root, reactivatedAt),
      ).resolves.toMatchObject({ status: OrganizationStatus.ACTIVE });
    });

    it('refuses with 409 BALANCE_OUTSTANDING while a line due before now is unpaid', async () => {
      const { root, org, suspended } = await invoiced([
        {
          type: InvoiceLineType.LATE_FEE,
          amountVnd: 50_000n,
          paidVnd: 0n,
          dueAt: new Date('2026-10-20T02:00:00.000Z'),
        },
        {
          type: InvoiceLineType.TERM_BALANCE,
          amountVnd: 125_000n,
          paidVnd: 0n,
          dueAt: new Date('2026-11-30T02:00:00.000Z'),
        },
      ]);

      const refusal = await service
        .reactivate(org.id, suspended.version, root, reactivatedAt)
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(DomainException);
      expect((refusal as DomainException).getStatus()).toBe(409);
      expect((refusal as DomainException).errorCode).toBe(ErrorCode.BALANCE_OUTSTANDING);
      expect((await read(org.id)).status).toBe(OrganizationStatus.SUSPENDED);
    });
  });

  // Migration 20261030210000 (review of treklink-web#135): the status history of api-design 11 is the
  // Manager's through a permission, which the Operator does not inherit.
  it('grants organization.history.read.own to the Org Manager only', async () => {
    const holders = await prisma.rolePermission.findMany({
      where: { permission: { key: 'organization.history.read.own' } },
      select: { role: { select: { key: true } }, permission: true },
    });

    expect(holders.map((row) => row.role.key)).toEqual(['ORG_MANAGER']);
    expect(holders[0].permission).toMatchObject({
      action: 'readHistory',
      subject: 'Organization',
      accountType: AccountType.ORGANIZATION,
      conditions: { id: '${user.organizationId}' },
    });
  });

  it('lets only one of two Admins suspend the same version of an organization', async () => {
    const first = await admin();
    const second = await admin();
    const { org } = await organization(first);

    const results = await Promise.allSettled([
      service.suspend(org.id, 'First', org.version, first),
      service.suspend(org.id, 'Second', org.version, second),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect([ErrorCode.STALE_VERSION, ErrorCode.INVALID_STATE_TRANSITION]).toContain(
      (refused?.reason as DomainException).errorCode,
    );
    expect(await prisma.organizationTransition.count({ where: { organizationId: org.id } })).toBe(
      1,
    );
  });

  it('suspends for a defaulted contract as SYSTEM, inside the caller transaction, and leaves a suspended one alone', async () => {
    const root = await admin();
    const { org } = await organization(root);
    const at = new Date();

    const changed = await events.transaction((tx) =>
      organizationsService.suspendForDefault(org.id, 'RC-2026-0042', at, tx),
    );
    const again = await events.transaction((tx) =>
      organizationsService.suspendForDefault(org.id, 'RC-2026-0042', at, tx),
    );

    expect(changed).toBe(true);
    expect(again).toBe(false);
    expect(await read(org.id)).toMatchObject({
      status: OrganizationStatus.SUSPENDED,
      suspensionReason: 'Contract RC-2026-0042 defaulted',
    });
    const history = await service.transitions(org.id, root, staffAbility);
    expect(history).toEqual([
      expect.objectContaining({ actor: 'SYSTEM', reason: 'Contract RC-2026-0042 defaulted' }),
    ]);
  });
});
