import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, ContractStatus, PlanType, Prisma } from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ContractLifecycleService } from '../src/modules/rentals/contract-lifecycle.service';
import { ContractsRepository, NewContract } from '../src/modules/rentals/contracts.repository';
import { ContractsService } from '../src/modules/rentals/contracts.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The rentals foundation against Postgres (rentals tasks 1.1 to 1.3): the one-live-row index, code
// allocation and the lifecycle under concurrent requests, and custody intervals. Run only through
// test:db against a migrated disposable database. Never deletes data: fixtures carry a fresh run ID.
describe('rentals foundation against Postgres (REQ-UBI-01, REQ-UBI-02, BR-03)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new ContractsRepository(prisma);
  const events = new TransactionalEvents(prisma, new EventEmitter2());
  const lifecycle = new ContractLifecycleService(repository, events);
  // The custody and close-check reads use only the repository; the request's collaborators stay out.
  const contracts = new ContractsService(
    repository,
    {} as never,
    {} as never,
    {} as never,
    events,
    {} as never,
  );
  const at = new Date('2026-10-25T02:00:00.000Z');
  const runId = randomUUID();
  const staff = { id: '', roles: ['STAFF'], organizationId: null };
  let organizationId: string;
  let variantId: string;
  let serial = 0;

  const user = async (role: string, accountType: AccountType) =>
    (
      await prisma.user.create({
        data: {
          email: `rentals-test-${runId}-${role}@example.invalid`,
          fullName: `Rentals test ${role}`,
          accountType,
        },
      })
    ).id;

  const device = async () => {
    serial += 1;
    return (
      await prisma.device.create({
        data: {
          assetTag: `rentals-test-${runId}-${serial}`,
          nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
          hardwareVariantId: variantId,
          firmwareVersion: 'test-only',
          acquiredAt: at,
          registeredById: staff.id,
        },
      })
    ).id;
  };

  let requester: string;
  const request = (): NewContract => ({
    organizationId,
    planType: PlanType.MONTHLY,
    dayPlanDays: null,
    hardwareVariantId: variantId,
    quantity: 1,
    requestedStartDate: new Date('2026-11-01T00:00:00.000Z'),
    monthlyUnitPriceVnd: 250_000n,
    dayPremium: null,
    holdingFeeRatio: new Prisma.Decimal('0.5'),
    requestedById: requester,
  });

  const newContract = () =>
    prisma.$transaction((tx) => repository.insertRequested(request(), at, tx), {
      maxWait: 15000,
      timeout: 15000,
    });

  beforeAll(async () => {
    await prisma.$connect();
    staff.id = await user('staff', AccountType.TREKLINK);
    requester = await user('manager', AccountType.ORGANIZATION);
    organizationId = (
      await prisma.organization.create({
        data: {
          code: `RT-${runId.slice(0, 8)}`,
          legalName: 'Rentals test organization',
          taxCode: `rentals-${runId}`,
          address: 'Test address',
          contactEmail: `rentals-test-${runId}@example.invalid`,
          contactPhone: '0900000000',
        },
      })
    ).id;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `rentals-test-${runId}`,
          name: 'Rentals test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuses a second live row for one device, and allows it once the first is released (BR-03)', async () => {
    const deviceId = await device();
    const [first, second] = [await newContract(), await newContract()];

    await prisma.$transaction((tx) =>
      repository.insertContractDevices([{ contractId: first.id, deviceId }], tx),
    );
    await expect(
      prisma.$transaction((tx) =>
        repository.insertContractDevices([{ contractId: second.id, deviceId }], tx),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.contractDevice.updateMany({
      where: { contractId: first.id, deviceId },
      data: { releasedAt: at },
    });
    await prisma.$transaction((tx) =>
      repository.insertContractDevices([{ contractId: second.id, deviceId }], tx),
    );
    expect(await prisma.contractDevice.count({ where: { deviceId } })).toBe(2);
  });

  it('allocates unique RC-2026-NNNN codes to concurrent requests, each with its first transition', async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => newContract()));

    expect(new Set(created.map((contract) => contract.code)).size).toBe(5);
    for (const contract of created) expect(contract.code).toMatch(/^RC-2026-\d{4}$/);
    const firsts = await prisma.contractTransition.findMany({
      where: { contractId: { in: created.map((contract) => contract.id) } },
    });
    expect(firsts).toHaveLength(5);
    expect(firsts.every((row) => row.fromStatus === null && row.toStatus === 'REQUESTED')).toBe(
      true,
    );
  });

  it('applies a transition with one row and a new version, and lets one of two concurrent ones win', async () => {
    const contract = await newContract();

    const results = await Promise.allSettled([
      prisma.$transaction((tx) =>
        lifecycle.apply(
          contract.id,
          ContractStatus.REQUESTED,
          ContractStatus.APPROVED,
          null,
          staff,
          tx,
        ),
      ),
      prisma.$transaction((tx) =>
        lifecycle.apply(
          contract.id,
          ContractStatus.REQUESTED,
          ContractStatus.REJECTED,
          'Out of stock',
          staff,
          tx,
        ),
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { errorCode: ErrorCode.INVALID_STATE_TRANSITION },
    });
    const row = await prisma.rentalContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.version).toBe(1);
    expect([ContractStatus.APPROVED, ContractStatus.REJECTED]).toContain(row.status);
    expect(
      await prisma.contractTransition.count({
        where: { contractId: contract.id, fromStatus: 'REQUESTED' },
      }),
    ).toBe(1);
  });

  it('finds the custody interval containing a time, and blocks closing the organization meanwhile', async () => {
    const deviceId = await device();
    const contract = await newContract();
    await prisma.$transaction((tx) =>
      repository.insertContractDevices([{ contractId: contract.id, deviceId }], tx),
    );
    const handedOverAt = new Date('2026-10-20T02:00:00.000Z');
    const checkedInAt = new Date('2026-10-23T02:00:00.000Z');
    await prisma.contractDevice.updateMany({
      where: { contractId: contract.id, deviceId },
      data: { handedOverAt, checkedInAt },
    });

    await expect(
      contracts.custodyAt(deviceId, new Date('2026-10-21T02:00:00.000Z'), 60),
    ).resolves.toMatchObject({ contractId: contract.id, organizationId, nearBoundary: false });
    await expect(contracts.custodyAt(deviceId, checkedInAt, 60)).resolves.toBeNull();
    await expect(
      contracts.custodyAt(deviceId, new Date('2026-10-19T02:00:00.000Z'), 60),
    ).resolves.toBeNull();

    await expect(contracts.canClose(organizationId)).resolves.toBe(false);
  });
});
