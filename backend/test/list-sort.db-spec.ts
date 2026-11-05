import { randomUUID } from 'node:crypto';
import {
  AccountType,
  ContractStatus,
  DeviceStatus,
  IncidentConfidence,
  IncidentSource,
  IncidentState,
  LossCaseState,
  MaintenanceStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import { ListSort } from '../src/common/dto/sorting';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository, DEVICE_SORT_FIELDS } from '../src/modules/devices/devices.repository';
import {
  LOSS_CASE_SORT_FIELDS,
  LossCasesRepository,
} from '../src/modules/devices/loss-cases.repository';
import {
  MAINTENANCE_SORT_FIELDS,
  MaintenanceRepository,
} from '../src/modules/devices/maintenance.repository';
import {
  INCIDENT_SORT_FIELDS,
  IncidentsRepository,
} from '../src/modules/incidents/incidents.repository';
import {
  CONTRACT_SORT_FIELDS,
  ContractsRepository,
} from '../src/modules/rentals/contracts.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The server sort of the paged lists (W26, chapter 06 §11.2) against Postgres: for every field of each
// allowlist, two seeded rows come back in ascending and in descending order, through the repository
// query the endpoint runs. Each fixture pair is built so the first row is lower on every allowed field.
// Fixtures carry a fresh run token and every read is narrowed to them; nothing is deleted.
describe('server sort of the paged lists against Postgres (W26)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const devices = new DevicesRepository(prisma);
  const maintenance = new MaintenanceRepository(prisma);
  const lossCases = new LossCasesRepository(prisma);
  const incidents = new IncidentsRepository(prisma);
  const contracts = new ContractsRepository(prisma);
  const runId = randomUUID();
  const token = runId.slice(0, 8).toUpperCase();
  const nodeBase = BigInt(Date.now() % 1_000_000_000) * 4n + 3_000_000_000n;
  let userId: string;
  let organizationId: string;
  let deviceA: string;
  let deviceB: string;
  let recordA: string;
  let recordB: string;
  let caseA: string;
  let caseB: string;
  let incidentA: string;
  let incidentB: string;
  let contractA: string;
  let contractB: string;

  const orderOf = (ids: string[], first: string, second: string) =>
    ids.filter((id) => id === first || id === second);

  const both = <F extends string>(
    fields: readonly F[],
  ): { field: F; order: ListSort<F>['order'] }[] =>
    fields.flatMap((field) => [
      { field, order: 'asc' as const },
      { field, order: 'desc' as const },
    ]);

  beforeAll(async () => {
    await prisma.$connect();
    userId = (
      await prisma.user.create({
        data: {
          email: `sort-test-${runId}@example.invalid`,
          fullName: 'Sort test staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    organizationId = (
      await prisma.organization.create({
        data: {
          code: `SORT-${token}`,
          legalName: `Sort test ${token}`,
          taxCode: `sort-${runId}`,
          address: 'Test address',
          contactEmail: `sort-org-${runId}@example.invalid`,
          contactPhone: '0900000000',
        },
      })
    ).id;
    const variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `sort-test-${runId}`,
          name: 'Sort test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
    const device = (suffix: string, low: boolean) =>
      prisma.device.create({
        data: {
          assetTag: `W26-${token}-${suffix}`,
          nodeNum: nodeBase + (low ? 0n : 1n),
          hardwareVariantId: variantId,
          firmwareVersion: 'test-only',
          acquiredAt: new Date('2026-01-01T00:00:00.000Z'),
          status: low ? DeviceStatus.AVAILABLE : DeviceStatus.MAINTENANCE,
          registeredById: userId,
          batteryPct: low ? 10 : 90,
          lastSeenAt: new Date(low ? '2026-11-01T00:00:00.000Z' : '2026-11-02T00:00:00.000Z'),
          serviceDueAt: new Date(low ? '2027-01-01' : '2027-02-01'),
        },
      });
    deviceA = (await device('A', true)).id;
    deviceB = (await device('B', false)).id;

    // Expected in 1980, so the `expectedBy` bound below leaves every other record out.
    const record = (deviceId: string, low: boolean) =>
      prisma.maintenanceRecord.create({
        data: {
          deviceId,
          reason: 'STAFF_REPORTED',
          status: low ? MaintenanceStatus.OPEN : MaintenanceStatus.COMPLETED,
          description: 'Sort test record',
          expectedAt: new Date(low ? '1980-01-01' : '1980-01-02'),
          openedById: userId,
        },
      });
    recordA = (await record(deviceA, true)).id;
    recordB = (await record(deviceB, false)).id;

    const lossCase = (deviceId: string, low: boolean) =>
      prisma.lossCase.create({
        data: {
          code: `LOSS-W26-${token}-${low ? 'A' : 'B'}`,
          deviceId,
          organizationId,
          state: low ? LossCaseState.REPORTED : LossCaseState.SEARCHING,
          stateFromDevice: DeviceStatus.RENTED,
          reportedById: userId,
          reportedAt: new Date(low ? '2026-10-01T00:00:00.000Z' : '2026-10-02T00:00:00.000Z'),
          description: 'Sort test case',
        },
      });
    caseA = (await lossCase(deviceA, true)).id;
    caseB = (await lossCase(deviceB, false)).id;

    // The low incident has the later deadline, so the default urgency order puts the high one first.
    const incident = (deviceId: string, low: boolean) =>
      prisma.incident.create({
        data: {
          code: `INC-W26-${token}-${low ? 'A' : 'B'}`,
          deviceId,
          organizationId,
          state: low ? IncidentState.NOTIFY_PRIMARY : IncidentState.ACKNOWLEDGED,
          source: IncidentSource.DEVICE_SOS,
          confidence: IncidentConfidence.CONFIRMED,
          firstEventAt: new Date('2026-10-01T00:00:00.000Z'),
          lastEventAt: new Date(low ? '2026-10-01T01:00:00.000Z' : '2026-10-01T02:00:00.000Z'),
          tierDeadlineAt: new Date(low ? '2026-10-01T03:00:00.000Z' : '2026-10-01T02:30:00.000Z'),
        },
      });
    incidentA = (await incident(deviceA, true)).id;
    incidentB = (await incident(deviceB, false)).id;

    // The low contract changed status first, so the default newest-change order puts it last.
    const contract = (low: boolean) =>
      prisma.rentalContract.create({
        data: {
          code: `RC-W26-${token}-${low ? 'A' : 'B'}`,
          organizationId,
          planType: PlanType.MONTHLY,
          hardwareVariantId: variantId,
          quantity: low ? 1 : 3,
          requestedStartDate: new Date(low ? '2026-12-01' : '2026-12-15'),
          monthlyUnitPriceVnd: 250_000n,
          holdingFeeRatio: new Prisma.Decimal('0.5'),
          status: low ? ContractStatus.REQUESTED : ContractStatus.APPROVED,
          statusChangedAt: new Date(low ? '2026-11-01T00:00:00.000Z' : '2026-11-02T00:00:00.000Z'),
          requestedById: userId,
        },
      });
    contractA = (await contract(true)).id;
    contractB = (await contract(false)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('devices api-design 06', () => {
    it.each(both(DEVICE_SORT_FIELDS))('sorts by $field $order', async (sort) => {
      const [rows, total] = await devices.page({ q: `W26-${token}` }, 0, 20, sort);
      const expected = sort.order === 'asc' ? [deviceA, deviceB] : [deviceB, deviceA];
      expect(
        orderOf(
          rows.map((row) => row.id),
          deviceA,
          deviceB,
        ),
      ).toEqual(expected);
      expect(total).toBe(2);
    });

    it('keeps the asset tag order without a sort', async () => {
      const [rows] = await devices.page({ q: `W26-${token}` }, 0, 20);
      expect(rows.map((row) => row.id)).toEqual([deviceA, deviceB]);
    });
  });

  describe('devices api-design 15', () => {
    const filter = { expectedBy: new Date('1980-12-31') };

    it.each(both(MAINTENANCE_SORT_FIELDS))('sorts by $field $order', async (sort) => {
      const [rows] = await maintenance.page(filter, 0, 100, sort);
      const expected = sort.order === 'asc' ? [recordA, recordB] : [recordB, recordA];
      expect(
        orderOf(
          rows.map((row) => row.id),
          recordA,
          recordB,
        ),
      ).toEqual(expected);
    });

    it('keeps the expected date order without a sort', async () => {
      const [rows] = await maintenance.page(filter, 0, 100);
      expect(
        orderOf(
          rows.map((row) => row.id),
          recordA,
          recordB,
        ),
      ).toEqual([recordA, recordB]);
    });
  });

  describe('incidents api-design 01', () => {
    it.each(both(INCIDENT_SORT_FIELDS))('sorts by $field $order', async (sort) => {
      const [rows, total] = await incidents.page({ organizationId }, 0, 20, sort);
      const expected = sort.order === 'asc' ? [incidentA, incidentB] : [incidentB, incidentA];
      expect(rows.map((row) => row.id)).toEqual(expected);
      expect(total).toBe(2);
    });

    it('keeps the most urgent deadline first without a sort (D-059 rule 7)', async () => {
      const [rows] = await incidents.page({ organizationId }, 0, 20);
      expect(rows.map((row) => row.id)).toEqual([incidentB, incidentA]);
    });
  });

  describe('rentals api-design 02', () => {
    it.each(both(CONTRACT_SORT_FIELDS))('sorts by $field $order', async (sort) => {
      const [rows, total] = await contracts.page({ organizationId }, 0, 20, undefined, sort);
      const expected = sort.order === 'asc' ? [contractA, contractB] : [contractB, contractA];
      expect(rows.map((row) => row.id)).toEqual(expected);
      expect(total).toBe(2);
    });

    it('keeps the newest status change first without a sort', async () => {
      const [rows] = await contracts.page({ organizationId }, 0, 20);
      expect(rows.map((row) => row.id)).toEqual([contractB, contractA]);
    });
  });

  describe('devices api-design 18', () => {
    it.each(both(LOSS_CASE_SORT_FIELDS))('sorts by $field $order', async (sort) => {
      const [rows, total] = await lossCases.page({ organizationId }, 0, 20, undefined, sort);
      const expected = sort.order === 'asc' ? [caseA, caseB] : [caseB, caseA];
      expect(rows.map((row) => row.id)).toEqual(expected);
      expect(total).toBe(2);
    });

    it('keeps the newest report first without a sort', async () => {
      const [rows] = await lossCases.page({ organizationId }, 0, 20);
      expect(rows.map((row) => row.id)).toEqual([caseB, caseA]);
    });
  });
});
