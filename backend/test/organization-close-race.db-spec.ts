import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, MemberRole, OrganizationStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { OneTimeCodeService } from '../src/modules/auth/one-time-code.service';
import { PasswordFlowsService } from '../src/modules/auth/password-flows.service';
import { PricingService } from '../src/modules/billing';
import { DevicesService } from '../src/modules/devices';
import { ApiKeysRepository } from '../src/modules/organizations/api-keys.repository';
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
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';
import { ContractsService } from '../src/modules/rentals/contracts.service';
import { RentalsOrganizationExitCheck } from '../src/modules/rentals/providers/organization-exit-check.provider';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// A contract request racing an organization closing (rentals api-design 01, organizations api-design
// 10, follow-up of treklink-web#135). The request holds the organization row FOR SHARE and the
// closing locks it FOR UPDATE before the rentals check counts unfinished contracts, so whichever
// commits first wins and no REQUESTED contract is left on a CLOSED organization. Pricing, parameters
// and the variant list are fakes; the organizations and rentals services and both transactions are
// real. Run only through test:db against a migrated disposable database. Fixtures carry a fresh run
// ID and are never deleted.
describe('Contract request against an organization closing, on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const events = new TransactionalEvents(prisma, new EventEmitter2());
  const accountsRepository = new AccountsRepository(prisma);
  const accounts = new AccountsService(
    accountsRepository,
    new OneTimeCodeService(accountsRepository, {
      get: () => Promise.resolve(72),
    } as unknown as ParameterService),
    { sendCode: () => Promise.resolve() } as unknown as PasswordFlowsService,
    events,
    { get: () => 20 } as unknown as ConfigService<ValidatedEnvironment, true>,
  );
  const organizationsRepository = new OrganizationsRepository(prisma);
  const members = new MembersRepository(prisma);
  const lifecycle = new OrganizationLifecycle(organizationsRepository, events);
  const organizationsService = new OrganizationsService(
    organizationsRepository,
    members,
    accounts,
    lifecycle,
  );

  // A gate a fake collaborator waits on, so one transaction stops after taking its lock.
  const gate = () => {
    let release!: () => void;
    let reached!: () => void;
    const opened = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    return { opened, arrived, release, reached };
  };
  let requestGate: ReturnType<typeof gate> | null = null;
  let variantId = '';
  const parameters = {
    get: async (key: string) => {
      if (requestGate) {
        requestGate.reached();
        await requestGate.opened;
      }
      return key === 'rentals.minOrderQuantity' ? 1 : [3, 4, 7];
    },
  } as unknown as ParameterService;
  const devices = {
    variants: () => Promise.resolve([{ id: variantId, isActive: true }]),
  } as unknown as DevicesService;
  const pricing = {
    snapshot: () =>
      Promise.resolve({
        monthlyUnitPriceVnd: 250_000n,
        dayPremium: null,
        holdingFeeRatio: new Prisma.Decimal('0.5'),
      }),
  } as unknown as PricingService;
  const contracts = new ContractsService(
    new ContractsRepository(prisma),
    organizationsService,
    pricing,
    parameters,
    events,
    devices,
  );

  const checks: OrganizationExitCheck[] = [];
  const rentalsCheck = new RentalsOrganizationExitCheck(contracts, checks);
  const status = new OrganizationStatusService(
    lifecycle,
    organizationsRepository,
    organizationsService,
    members,
    new ApiKeysRepository(prisma),
    new FieldStationsRepository(prisma),
    accounts,
    events,
    checks,
  );

  const at = new Date('2026-10-25T02:00:00.000Z');
  const runId = randomUUID();
  let serial = 0;

  const account = async (role: string, accountType: AccountType) => {
    serial += 1;
    return accountsRepository.create({
      email: `close-race-${runId}-${serial}@example.invalid`,
      fullName: `Close race ${serial}`,
      accountType,
      roleKeys: [role],
    });
  };

  // An ACTIVE organization with one Manager, who is the requesting caller.
  const organization = async () => {
    serial += 1;
    const org = await prisma.organization.create({
      data: {
        code: `CR-${runId.slice(0, 8)}-${serial}`,
        legalName: `Close race ${serial}`,
        taxCode: `CR${runId}-${serial}`,
        address: '1 Test Street',
        contactEmail: `close-race-org-${runId}-${serial}@example.invalid`,
        contactPhone: '0900000000',
        status: OrganizationStatus.ACTIVE,
      },
    });
    const user = await account('ORG_MANAGER', AccountType.ORGANIZATION);
    await prisma.organizationMember.create({
      data: { userId: user.id, organizationId: org.id, role: MemberRole.MANAGER },
    });
    const manager: Caller = { id: user.id, roles: ['ORG_MANAGER'], organizationId: org.id };
    return { org, manager };
  };

  const requestFor = (manager: Caller) =>
    contracts.request(
      {
        planType: PlanType.MONTHLY,
        hardwareVariantId: variantId,
        quantity: 1,
        requestedStartDate: new Date('2026-11-01T00:00:00.000Z'),
      },
      manager,
      at,
    );

  // Resolves once `pending` has settled or some session of this database waits on a row lock.
  const blockedOrSettled = async (pending: Promise<unknown>) => {
    let settled = false;
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (settled) return;
      const [row] = await prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (row.waiting > 0n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The second transaction neither settled nor waited on a lock.');
  };

  const statusOf = async (id: string) =>
    (await prisma.organization.findUniqueOrThrow({ where: { id } })).status;
  const contractsOf = (organizationId: string) =>
    prisma.rentalContract.count({ where: { organizationId } });

  let root: Caller;

  beforeAll(async () => {
    await prisma.$connect();
    const admin = await account('ADMIN', AccountType.TREKLINK);
    root = { id: admin.id, roles: ['ADMIN'], organizationId: null };
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `close-race-${runId}`,
          name: 'Close race variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
  });

  afterEach(() => {
    requestGate = null;
    checks.splice(0, checks.length, rentalsCheck);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('makes a closing wait for a request in flight, then count its contract and refuse (409 OPEN_CONTRACTS)', async () => {
    const { org, manager } = await organization();
    requestGate = gate();
    const request = requestFor(manager);
    await requestGate.arrived;

    const closing = status.close(org.id, 'Customer request', org.version, root);
    await blockedOrSettled(closing);
    requestGate.release();

    await expect(request).resolves.toMatchObject({ contract: { status: 'REQUESTED' } });
    await expect(closing).rejects.toMatchObject({ errorCode: ErrorCode.OPEN_CONTRACTS });
    expect(await statusOf(org.id)).toBe(OrganizationStatus.ACTIVE);
    expect(await contractsOf(org.id)).toBe(1);
  });

  it('makes a request wait for a closing in flight, then refuse it as CLOSED (409 ORGANIZATION_NOT_ACTIVE)', async () => {
    const { org, manager } = await organization();
    // Runs on the locked row before the rentals check, holding the closing open.
    const closeGate = gate();
    checks.unshift({
      canReactivate: () => Promise.resolve(null),
      canClose: async () => {
        closeGate.reached();
        await closeGate.opened;
        return null;
      },
    });
    const closing = status.close(org.id, 'Customer request', org.version, root);
    await closeGate.arrived;

    const request = requestFor(manager);
    await blockedOrSettled(request);
    closeGate.release();

    await expect(closing).resolves.toMatchObject({ status: OrganizationStatus.CLOSED });
    await expect(request).rejects.toMatchObject({
      errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      message: 'Your organization cannot request devices while it is CLOSED.',
    });
    expect(await contractsOf(org.id)).toBe(0);
  });
});
