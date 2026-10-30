import {
  DeviceStatus,
  IncidentConfidence,
  IncidentSource,
  InspectionResult,
  OrganizationStatus,
  PlanType,
} from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { DevicesService } from '../src/modules/devices';
import { ContractDecisionsService } from '../src/modules/rentals/contract-decisions.service';
import { ReturnService } from '../src/modules/rentals/return.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, ContractTerms, RentalFlow } from './db-rental-flow';

// A 1 x 1 PNG, the smallest signature the routes accept.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Today in UTC+7, as the date column of a contract that may be handed over now over HTTP.
const today = () => {
  const local = new Date(Date.now() + 7 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
};

// The 409 rows of rentals api-design 01 to 17 and billing api-design 06, 11, 13 and 17 through the
// HTTP pipeline against Postgres (rentals task 6.2, billing task 5.2): the whole application with
// the scheduler replaced, real guards, policies and services, and each state built through the real
// services (test/db-rental-flow.ts). A route that answers the code with the standard envelope passes.
// Run only through test:db against a migrated disposable database.
describe('contract and billing 409 rows over HTTP against Postgres', () => {
  let flow: RentalFlow;

  const expectConflict = (response: Awaited<ReturnType<RentalFlow['send']>>, errorCode: string) => {
    expect({ status: response.status, body: response.body as unknown }).toMatchObject({
      status: 409,
      body: { isSuccess: false, statusCode: 409, result: { errorCode } },
    });
  };

  // A REQUESTED contract of 5 units, with 5 AVAILABLE units of its variant.
  const requested = async (terms: ContractTerms = {}, spare = 0) => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    const deviceIds = await flow.availableDevices(variantId, 5 + spare);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5, terms);
    return { org, variantId, deviceIds, contract };
  };

  const approved = async (terms: ContractTerms = {}, spare = 0) => {
    const state = await requested(terms, spare);
    await flow.approve(state.contract.id);
    const rows = await flow.prisma.contractDevice.findMany({
      where: { contractId: state.contract.id, releasedAt: null },
    });
    return { ...state, reserved: rows.map((row) => row.deviceId) };
  };

  // Monthly with notice given, past its term end: RETURN_DUE with every unit still out.
  const returnDue = async () => {
    const state = await flow.rented(5);
    await flow
      .get(ContractDecisionsService)
      .giveNotice(
        state.contract.id,
        await flow.version(state.contract.id),
        state.org.manager,
        at('2026-11-10T02:00:00.000Z'),
      );
    await flow.get(TermRolloverJob).run(at('2026-12-02T03:00:00.000Z'));
    return state;
  };

  const returned = async () => {
    const state = await returnDue();
    await flow
      .get(ReturnService)
      .checkIn(state.contract.id, state.tags, flow.staff, at('2026-12-02T05:00:00.000Z'));
    return state;
  };

  const path = (contractId: string, rest = '') => `/api/contracts/${contractId}${rest}`;
  const unknownDevice = '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10';

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  });

  afterAll(async () => {
    await flow?.close();
  });

  it('01: a request from an organization that is not ACTIVE is ORGANIZATION_NOT_ACTIVE', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    await flow.prisma.organization.update({
      where: { id: org.id },
      data: { status: OrganizationStatus.SUSPENDED },
    });
    expectConflict(
      await flow.send(org.manager, 'post', '/api/contracts', {
        planType: 'MONTHLY',
        hardwareVariantId: variantId,
        quantity: 5,
        requestedStartDate: '2027-01-04',
      }),
      'ORGANIZATION_NOT_ACTIVE',
    );
  });

  describe('04 approve', () => {
    const approve = async (contractId: string, body: object = {}) =>
      flow.send(flow.staff, 'post', path(contractId, '/approve'), {
        handoverAt: '2026-11-02T02:00:00.000Z',
        expectedVersion: await flow.version(contractId),
        ...body,
      });

    it('INSUFFICIENT_DEVICES with too few units', async () => {
      const org = await flow.organization();
      const variantId = await flow.variant();
      await flow.availableDevices(variantId, 2);
      const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
      expectConflict(await approve(contract.id), 'INSUFFICIENT_DEVICES');
    });

    it('DEVICE_NOT_AVAILABLE for a chosen unit that is not AVAILABLE', async () => {
      const { contract, deviceIds } = await requested();
      await flow.prisma.device.update({
        where: { id: deviceIds[0] },
        data: { status: DeviceStatus.MAINTENANCE },
      });
      expectConflict(await approve(contract.id, { deviceIds }), 'DEVICE_NOT_AVAILABLE');
    });

    it('INVALID_STATE_TRANSITION and STALE_VERSION', async () => {
      const { contract } = await approved();
      expectConflict(await approve(contract.id), 'INVALID_STATE_TRANSITION');
      expectConflict(await approve(contract.id, { expectedVersion: 0 }), 'STALE_VERSION');
    });
  });

  it.each(['reject', 'cancel'])(
    '05 and 06: %s answers INVALID_STATE_TRANSITION past its states and STALE_VERSION',
    async (action) => {
      const { contract, org } = await flow.rented(5);
      const caller = action === 'reject' ? flow.staff : org.manager;
      const body = async (version?: number) => ({
        reason: 'No longer needed',
        expectedVersion: version ?? (await flow.version(contract.id)),
      });
      expectConflict(
        await flow.send(caller, 'post', path(contract.id, `/${action}`), await body()),
        'INVALID_STATE_TRANSITION',
      );
      expectConflict(
        await flow.send(caller, 'post', path(contract.id, `/${action}`), await body(0)),
        'STALE_VERSION',
      );
    },
  );

  describe('07 swap, 08 preview, 09 provisioning, 11 note', () => {
    const swap = (contractId: string, deviceId: string) =>
      flow.send(flow.staff, 'post', path(contractId, `/devices/${deviceId}/swap`), {
        reason: 'No GPS fix',
      });

    it('07: DEVICE_NOT_ON_CONTRACT, INSUFFICIENT_DEVICES with no spare, INVALID_STATE_TRANSITION once ACTIVE', async () => {
      const { contract, reserved } = await approved();
      expectConflict(await swap(contract.id, unknownDevice), 'DEVICE_NOT_ON_CONTRACT');
      expectConflict(await swap(contract.id, reserved[0]), 'INSUFFICIENT_DEVICES');
      const active = await flow.rented(5);
      expectConflict(
        await swap(active.contract.id, active.deviceIds[0]),
        'INVALID_STATE_TRANSITION',
      );
    });

    it('08 and 11: the preview of a REQUESTED contract, and the note before signing', async () => {
      const { contract } = await requested();
      expectConflict(
        await flow.send(flow.staff, 'get', path(contract.id, '/handover-note/preview')),
        'INVALID_STATE_TRANSITION',
      );
      const signed = await approved();
      expectConflict(
        await flow.send(flow.staff, 'get', path(signed.contract.id, '/handover-note')),
        'NOTE_NOT_SIGNED',
      );
    });

    it('09: DEVICE_NOT_ON_CONTRACT, KEY_VERSION_MISMATCH, INVALID_STATE_TRANSITION', async () => {
      const { contract, reserved } = await approved();
      const provision = (contractId: string, deviceId: string, keyVersion: number) =>
        flow.send(flow.staff, 'post', path(contractId, `/devices/${deviceId}/provisioning`), {
          keyVersion,
        });
      expectConflict(await provision(contract.id, unknownDevice, 1), 'DEVICE_NOT_ON_CONTRACT');
      expectConflict(await provision(contract.id, reserved[0], 99), 'KEY_VERSION_MISMATCH');
      const open = await requested();
      expectConflict(
        await provision(open.contract.id, open.deviceIds[0], 1),
        'INVALID_STATE_TRANSITION',
      );
    });
  });

  describe('10 handover, at the real time', () => {
    const handover = async (
      contractId: string,
      manager: Caller,
      checks: { deviceId: string; batteryPct?: number; gpsFixOk?: boolean }[],
      change: object = {},
    ) =>
      flow.send(flow.staff, 'post', path(contractId, '/handover'), {
        signedByMemberId: manager.id,
        identityChecked: 'CCCD 001',
        signaturePng: PNG,
        deviceChecks: checks.map((check) => ({ batteryPct: 90, gpsFixOk: true, ...check })),
        acknowledgeLowBattery: false,
        expectedVersion: await flow.version(contractId),
        ...change,
      });

    const provisionAll = async (contractId: string, deviceIds: string[]) => {
      for (const deviceId of deviceIds) {
        await flow.send(flow.staff, 'post', path(contractId, `/devices/${deviceId}/provisioning`), {
          keyVersion: 1,
        });
      }
    };

    it('BEFORE_START_DATE, INVALID_STATE_TRANSITION and STALE_VERSION', async () => {
      // Handover runs on the real clock, so the start date must stay in the future whenever this runs.
      const future = await approved({ requestedStartDate: new Date(Date.now() + 60 * 86_400_000) });
      const checks = future.reserved.map((deviceId) => ({ deviceId }));
      expectConflict(
        await handover(future.contract.id, future.org.manager, checks),
        'BEFORE_START_DATE',
      );
      expectConflict(
        await handover(future.contract.id, future.org.manager, checks, { expectedVersion: 0 }),
        'STALE_VERSION',
      );
      const open = await requested();
      expectConflict(
        await handover(open.contract.id, open.org.manager, []),
        'INVALID_STATE_TRANSITION',
      );
    });

    it('FIRST_PAYMENT_MISSING, DEVICE_NOT_PROVISIONED, DEVICE_CHECK_FAILED, LOW_BATTERY in turn', async () => {
      const { contract, org, reserved } = await approved({ requestedStartDate: today() });
      const checks = reserved.map((deviceId) => ({ deviceId }));
      expectConflict(await handover(contract.id, org.manager, checks), 'FIRST_PAYMENT_MISSING');

      await flow.payAll(contract.id);
      expectConflict(await handover(contract.id, org.manager, checks), 'DEVICE_NOT_PROVISIONED');

      await provisionAll(contract.id, reserved);
      const failing = checks.map((check, index) => ({ ...check, gpsFixOk: index !== 0 }));
      expectConflict(await handover(contract.id, org.manager, failing), 'DEVICE_CHECK_FAILED');

      const low = checks.map((check, index) => ({ ...check, batteryPct: index === 0 ? 10 : 90 }));
      expectConflict(await handover(contract.id, org.manager, low), 'LOW_BATTERY');

      const done = await handover(contract.id, org.manager, low, { acknowledgeLowBattery: true });
      expect(done.status).toBe(200);
    });
  });

  describe('12 notice, 13 holder, 14 check-in', () => {
    it('12: DAY_PLAN_NO_NOTICE, INVALID_STATE_TRANSITION, STALE_VERSION', async () => {
      const notice = async (contractId: string, manager: Caller, version?: number) =>
        flow.send(manager, 'post', path(contractId, '/notice'), {
          expectedVersion: version ?? (await flow.version(contractId)),
        });
      const day = await flow.rented(5, {
        planType: PlanType.DAY,
        dayPlanDays: 4,
        dayPremium: '1.5',
      });
      expectConflict(await notice(day.contract.id, day.org.manager), 'DAY_PLAN_NO_NOTICE');
      const waiting = await approved();
      expectConflict(
        await notice(waiting.contract.id, waiting.org.manager),
        'INVALID_STATE_TRANSITION',
      );
      const active = await flow.rented(5);
      expectConflict(await notice(active.contract.id, active.org.manager, 0), 'STALE_VERSION');
    });

    it('13: DEVICE_NOT_ON_CONTRACT and INVALID_STATE_TRANSITION', async () => {
      const label = (contractId: string, manager: Caller, deviceId: string) =>
        flow.send(manager, 'put', path(contractId, `/devices/${deviceId}/holder`), {
          name: 'Nguyen Van A',
        });
      const active = await flow.rented(5);
      expectConflict(
        await label(active.contract.id, active.org.manager, unknownDevice),
        'DEVICE_NOT_ON_CONTRACT',
      );
      const waiting = await approved();
      expectConflict(
        await label(waiting.contract.id, waiting.org.manager, waiting.reserved[0]),
        'INVALID_STATE_TRANSITION',
      );
    });

    it('14: DEVICE_NOT_ON_CONTRACT on a running day plan, INVALID_STATE_TRANSITION on a running month', async () => {
      const checkIn = (contractId: string, assetTags: string[]) =>
        flow.send(flow.staff, 'post', path(contractId, '/check-ins'), { assetTags });
      const day = await flow.rented(5, {
        planType: PlanType.DAY,
        dayPlanDays: 4,
        dayPremium: '1.5',
      });
      expectConflict(await checkIn(day.contract.id, ['TL-NOT-HERE']), 'DEVICE_NOT_ON_CONTRACT');
      const month = await flow.rented(5);
      expectConflict(await checkIn(month.contract.id, month.tags), 'INVALID_STATE_TRANSITION');
    });
  });

  describe('15 replacement', () => {
    const replace = (
      contractId: string,
      deviceId: string,
      replacementDeviceId: string,
      change: object = {},
    ) =>
      flow.send(flow.staff, 'post', path(contractId, `/devices/${deviceId}/replacement`), {
        replacementDeviceId,
        keyVersion: 1,
        signatureImage: PNG,
        faultyPresent: true,
        ...change,
      });

    it('DEVICE_NOT_ON_CONTRACT, VARIANT_MISMATCH, DEVICE_NOT_AVAILABLE, KEY_VERSION_MISMATCH, LOSS_CASE_REQUIRED', async () => {
      const { contract, deviceIds, variantId, org } = await flow.rented(5);
      const [spare] = await flow.availableDevices(variantId, 1);
      const [otherVariant] = await flow.availableDevices(await flow.variant(), 1);
      expectConflict(await replace(contract.id, unknownDevice, spare), 'DEVICE_NOT_ON_CONTRACT');
      expectConflict(await replace(contract.id, deviceIds[0], otherVariant), 'VARIANT_MISMATCH');
      expectConflict(
        await replace(contract.id, deviceIds[0], deviceIds[1]),
        'DEVICE_NOT_AVAILABLE',
      );
      expectConflict(
        await replace(contract.id, deviceIds[0], spare, { keyVersion: 99 }),
        'KEY_VERSION_MISMATCH',
      );
      expectConflict(
        await replace(contract.id, deviceIds[0], spare, { faultyPresent: false }),
        'LOSS_CASE_REQUIRED',
      );

      // ORGANIZATION_NOT_ACTIVE once the organization is suspended.
      await flow.prisma.organization.update({
        where: { id: org.id },
        data: { status: OrganizationStatus.SUSPENDED },
      });
      expectConflict(await replace(contract.id, deviceIds[0], spare), 'ORGANIZATION_NOT_ACTIVE');
    });

    it('INVALID_STATE_TRANSITION on a contract that is RETURN_DUE', async () => {
      const { contract, deviceIds, variantId } = await returnDue();
      const [spare] = await flow.availableDevices(variantId, 1);
      expectConflict(await replace(contract.id, deviceIds[0], spare), 'INVALID_STATE_TRANSITION');
    });
  });

  describe('16 inspection, 17 close', () => {
    const inspect = (contractId: string, deviceId: string) =>
      flow.send(flow.staff, 'post', path(contractId, `/devices/${deviceId}/inspection`), {
        result: InspectionResult.PASSED,
      });
    const close = async (contractId: string, version?: number) =>
      flow.send(flow.staff, 'post', path(contractId, '/close'), {
        expectedVersion: version ?? (await flow.version(contractId)),
      });

    it('16: DEVICE_NOT_ON_CONTRACT, RESET_REQUIRED, INVALID_STATE_TRANSITION once CLOSED', async () => {
      const { contract, deviceIds } = await returned();
      expectConflict(await inspect(contract.id, unknownDevice), 'DEVICE_NOT_ON_CONTRACT');
      expectConflict(await inspect(contract.id, deviceIds[0]), 'RESET_REQUIRED');

      await flow.payAll(contract.id, at('2026-12-02T06:00:00.000Z'));
      const closed = await close(contract.id);
      expect(closed.status).toBe(200);
      await flow.prisma.$transaction((tx) =>
        flow
          .get(DevicesService)
          .reset(
            deviceIds[0],
            { keyRemoved: true, nodeDbCleared: true, ownerCleared: true },
            flow.staff.id,
            at('2026-12-02T07:00:00.000Z'),
            tx,
          ),
      );
      expectConflict(await inspect(contract.id, deviceIds[0]), 'INVALID_STATE_TRANSITION');
    });

    it('17: INVALID_STATE_TRANSITION, STALE_VERSION, BALANCE_OUTSTANDING, OPEN_INCIDENTS', async () => {
      const active = await flow.rented(5);
      expectConflict(await close(active.contract.id), 'INVALID_STATE_TRANSITION');

      // Back four days late: the late fee lines are still unpaid.
      const { contract, deviceIds, org, tags } = await returnDue();
      await flow
        .get(ReturnService)
        .checkIn(contract.id, tags, flow.staff, at('2026-12-06T02:00:00.000Z'));
      expectConflict(await close(contract.id, 0), 'STALE_VERSION');
      expectConflict(await close(contract.id), 'BALANCE_OUTSTANDING');

      await flow.payAll(contract.id, at('2026-12-02T06:00:00.000Z'));
      await flow.prisma.incident.create({
        data: {
          code: `INC-HTTP-${flow.next()}`,
          deviceId: deviceIds[0],
          contractId: contract.id,
          organizationId: org.id,
          source: IncidentSource.DEVICE_SOS,
          confidence: IncidentConfidence.CONFIRMED,
          firstEventAt: at('2026-11-20T02:00:00.000Z'),
          lastEventAt: at('2026-11-20T02:00:00.000Z'),
        },
      });
      expectConflict(await close(contract.id), 'OPEN_INCIDENTS');
    });
  });

  describe('billing 06, 11, 13, 17', () => {
    it('06: a second damage rate with the same code is CONFLICT_UNIQUE', async () => {
      const admin = await flow.admin();
      const rate = {
        code: `HTTP_${flow.next().replace(/-/g, '_').toUpperCase()}`,
        label: 'Case',
        amountVnd: 100_000,
      };
      expect((await flow.send(admin, 'post', '/api/damage-rates', rate)).status).toBe(201);
      expectConflict(await flow.send(admin, 'post', '/api/damage-rates', rate), 'CONFLICT_UNIQUE');
    });

    it('11: PAYMENT_PENDING while a request waits, NOTHING_DUE once paid', async () => {
      const { contract, org } = await approved();
      const invoice = await flow.prisma.invoice.findFirstOrThrow({
        where: { contractId: contract.id },
      });
      const pay = () =>
        flow.send(org.manager, 'post', `/api/invoices/${invoice.id}/payments/sepay`, {});
      expect((await pay()).status).toBe(201);
      expectConflict(await pay(), 'PAYMENT_PENDING');

      const paid = await approved();
      await flow.payAll(paid.contract.id);
      const settled = await flow.prisma.invoice.findFirstOrThrow({
        where: { contractId: paid.contract.id },
      });
      expectConflict(
        await flow.send(paid.org.manager, 'post', `/api/invoices/${settled.id}/payments/sepay`, {}),
        'NOTHING_DUE',
      );
    });

    it('13: a counter payment with a known reference is DUPLICATE_REFERENCE', async () => {
      const { contract } = await approved();
      const invoice = await flow.prisma.invoice.findFirstOrThrow({
        where: { contractId: contract.id },
      });
      const body = { method: 'CASH', amountVnd: 1_000, reference: `HTTP-${flow.next()}` };
      const pay = () =>
        flow.send(flow.staff, 'post', `/api/invoices/${invoice.id}/payments/counter`, body);
      expect((await pay()).status).toBe(201);
      expectConflict(await pay(), 'DUPLICATE_REFERENCE');
    });

    it('17: deciding a charge that is no longer pending is INVALID_STATE_TRANSITION', async () => {
      const { contract, deviceIds } = await returned();
      const inspector = await flow.admin();
      const code = `HTTP_${flow.next().replace(/-/g, '_').toUpperCase()}`;
      await flow.prisma.damageRate.create({
        data: { code, label: 'Case', amountVnd: 700_000n, createdById: inspector.id },
      });
      const back = at('2026-12-02T06:00:00.000Z');
      await flow.prisma.$transaction((tx) =>
        flow
          .get(DevicesService)
          .reset(
            deviceIds[0],
            { keyRemoved: true, nodeDbCleared: true, ownerCleared: true },
            flow.staff.id,
            back,
            tx,
          ),
      );
      await flow
        .get(ReturnService)
        .inspect(
          contract.id,
          deviceIds[0],
          { result: InspectionResult.DAMAGED, damageCodes: [code], note: null },
          inspector,
          back,
        );
      const charge = await flow.prisma.damageCharge.findFirstOrThrow({
        where: { contractId: contract.id },
      });
      const decider = await flow.admin();
      const decide = () =>
        flow.send(decider, 'post', `/api/damage-charges/${charge.id}/decision`, {
          decision: 'APPROVED',
          note: 'Photos match',
        });
      expect((await decide()).status).toBe(200);
      expectConflict(await decide(), 'INVALID_STATE_TRANSITION');
    });
  });
});
