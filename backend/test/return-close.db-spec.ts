import {
  ContractStatus,
  DamageChargeStatus,
  DeviceStatus,
  InspectionResult,
  InvoiceLineType,
  LossDecision,
  MaintenanceStatus,
} from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { DevicesService } from '../src/modules/devices/devices.service';
import { IntakeService } from '../src/modules/devices/intake.service';
import { LossCaseService } from '../src/modules/devices/loss-cases.service';
import { MaintenanceService } from '../src/modules/devices/maintenance.service';
import { ContractDecisionsService } from '../src/modules/rentals/contract-decisions.service';
import { ReturnService } from '../src/modules/rentals/return.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, RentalFlow } from './db-rental-flow';

// MF-05 as the supervisor ran it at the 2026-11-01 demo, against Postgres through the real services of
// AppModule (rentals REQ-EVT-18 and REQ-EVT-19, devices REQ-EVT-23, D-092 rules 3 and 4): a contract of
// five units, four checked in, one of them inspected DAMAGED, one missing. The missing unit is reported
// lost and settled, the balance is paid, and the contract closes with no replacement unit; the units
// back reach AVAILABLE, the damaged one after its maintenance and intake check. Run only through
// test:db against a migrated disposable database.
const SCHEDULE = [{ fromMonths: 0, valueVnd: 2_500_000 }];
const STEPS = { keyRemoved: true, nodeDbCleared: true, ownerCleared: true };

describe('return with a damaged and a missing unit, close and the path back to AVAILABLE (D-092)', () => {
  let flow: RentalFlow;
  let returns: ReturnService;
  let devices: DevicesService;
  let lossCases: LossCaseService;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
    returns = flow.get(ReturnService);
    devices = flow.get(DevicesService);
    lossCases = flow.get(LossCaseService);
    const expected = {
      'billing.damageApprovalThresholdVnd': 500_000,
      'rentals.returnGraceHours': 24,
      'rentals.termRolloverHourLocal': 9,
    };
    expect(await flow.seededParameters(Object.keys(expected))).toEqual(expected);
  });

  afterAll(async () => {
    await flow?.close();
  });

  const statusOf = async (deviceId: string) =>
    (await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status;

  const closeCheck = async (contractId: string) => {
    const response = await flow.send(flow.staff, 'get', `/api/contracts/${contractId}/close-check`);
    expect(response.status).toBe(200);
    return response.body as {
      result: {
        canClose: boolean;
        status: string;
        blockers: { code: string; assetTag?: string }[];
      };
      isSuccess: boolean;
    };
  };

  it('closes 5 units with 4 back, 1 damaged and 1 reported lost, and brings the units back to AVAILABLE', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant(SCHEDULE);
    const deviceIds = await flow.availableDevices(variantId, 5);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
    await flow.approve(contract.id);
    await flow.payAll(contract.id);
    await flow.handOver(contract.id, org.manager.id, deviceIds);
    const tags = new Map(
      (
        await flow.prisma.device.findMany({
          where: { id: { in: deviceIds } },
          select: { id: true, assetTag: true },
        })
      ).map((device) => [device.id, device.assetTag]),
    );
    const tagOf = (deviceId: string) => tags.get(deviceId)!;
    const [passedA, passedB, passedC, damaged, missing] = deviceIds;
    const damageCode = `CASING-${flow.next()}`;
    await flow.prisma.damageRate.create({
      data: {
        code: damageCode,
        label: 'Casing cracked',
        amountVnd: 400_000n,
        createdById: flow.staff.id,
      },
    });

    // Notice, then the term end: RETURN_DUE (rentals REQ-EVT-07).
    await flow
      .get(ContractDecisionsService)
      .giveNotice(
        contract.id,
        await flow.version(contract.id),
        org.manager,
        at('2026-11-10T02:00:00.000Z'),
      );
    await flow.get(TermRolloverJob).run(at('2026-12-02T03:00:00.000Z'));
    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURN_DUE);

    // Four units come back inside the grace; the fifth does not.
    const back = at('2026-12-02T05:00:00.000Z');
    const checkedIn = await returns.checkIn(
      contract.id,
      [passedA, passedB, passedC, damaged].map(tagOf),
      flow.staff,
      back,
    );
    expect(checkedIn).toMatchObject({ returned: 4, total: 5, contractStatus: 'RETURN_DUE' });

    // The close check says what blocks the close: the state and the missing unit, with no loss case yet.
    let check = await closeCheck(contract.id);
    expect(check.isSuccess).toBe(true);
    expect(check.result.canClose).toBe(false);
    expect(check.result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['NOT_RETURNED', 'DEVICE_OUT']),
    );
    expect(check.result.blockers.find((b) => b.code === 'DEVICE_OUT')).toMatchObject({
      assetTag: tagOf(missing),
      lossCase: null,
    });
    // The close itself refuses, as before.
    expect(
      await flow.codeOf(returns.close(contract.id, await flow.version(contract.id), flow.staff)),
    ).toBe(ErrorCode.INVALID_STATE_TRANSITION);

    // Reset and inspection: three pass, one is damaged and charged at inspection (REQ-EVT-11).
    const inspectedAt = at('2026-12-02T06:00:00.000Z');
    for (const deviceId of [passedA, passedB, passedC, damaged]) {
      await flow.prisma.$transaction((tx) =>
        devices.reset(deviceId, STEPS, flow.staff.id, inspectedAt, tx),
      );
    }
    for (const deviceId of [passedA, passedB, passedC]) {
      const passed = await returns.inspect(
        contract.id,
        deviceId,
        { result: InspectionResult.PASSED, damageCodes: [], note: null },
        flow.staff,
        inspectedAt,
      );
      expect(passed.device.status).toBe(DeviceStatus.AVAILABLE);
    }
    const inspected = await returns.inspect(
      contract.id,
      damaged,
      { result: InspectionResult.DAMAGED, damageCodes: [damageCode], note: null },
      flow.staff,
      inspectedAt,
    );
    expect(inspected.damageCharge).toMatchObject({
      amountVnd: 400_000,
      status: DamageChargeStatus.APPROVED,
    });

    // The contract page shows each unit's state after the return and its next step (REQ-EVT-19).
    const detail = await flow.send(flow.staff, 'get', `/api/contracts/${contract.id}`);
    const rows = (
      detail.body as {
        result: {
          devices: {
            deviceId: string;
            afterReturn: { status: string; nextStep: unknown } | null;
          }[];
        };
      }
    ).result.devices;
    const rowOf = (deviceId: string) => rows.find((row) => row.deviceId === deviceId)!;
    expect(rowOf(passedA).afterReturn).toEqual({ status: 'AVAILABLE', nextStep: null });
    expect(rowOf(damaged).afterReturn).toEqual({
      status: 'MAINTENANCE',
      nextStep: { action: 'COMPLETE_MAINTENANCE', contractId: null },
    });
    expect(rowOf(missing).afterReturn).toBeNull();
    // The Manager reads the same contract without the TrekLink-only state.
    const managerDetail = await flow.send(org.manager, 'get', `/api/contracts/${contract.id}`);
    expect(
      (
        managerDetail.body as { result: { devices: { afterReturn: unknown }[] } }
      ).result.devices.every((row) => row.afterReturn === null),
    ).toBe(true);
    // The close check is a Staff read.
    expect(
      (await flow.send(org.manager, 'get', `/api/contracts/${contract.id}/close-check`)).status,
    ).toBe(403);

    // The missing unit is reported lost by Staff, triaged and confirmed, then settled by an Admin
    // (devices 2.7, rentals REQ-EVT-12): the contract becomes RETURNED with no replacement unit.
    const reported = await lossCases.report(
      missing,
      { description: 'Not handed back at the counter' },
      flow.staff,
      at('2026-12-02T07:00:00.000Z'),
    );
    check = await closeCheck(contract.id);
    expect(check.result.blockers.find((b) => b.code === 'DEVICE_OUT')).toMatchObject({
      lossCase: { id: reported.id, state: 'REPORTED' },
    });
    const triaged = await lossCases.triage(
      reported.id,
      { suspectedTheft: false, expectedVersion: reported.version },
      flow.staff,
      at('2026-12-02T07:10:00.000Z'),
    );
    const confirmed = await lossCases.confirm(
      triaged.id,
      { expectedVersion: triaged.version },
      flow.staff,
      at('2026-12-02T07:20:00.000Z'),
    );
    await lossCases.decide(
      confirmed.id,
      { decision: LossDecision.CHARGED, expectedVersion: confirmed.version },
      await flow.admin(),
      at('2026-12-02T07:30:00.000Z'),
    );
    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURNED);

    // Only the balance blocks now: the term balance, the damage and the loss line.
    check = await closeCheck(contract.id);
    expect(check.result.status).toBe('RETURNED');
    expect(check.result.blockers.map((blocker) => blocker.code)).toEqual(['BALANCE_OUTSTANDING']);
    const lines = await flow.prisma.invoiceLine.findMany({
      where: {
        invoice: { contractId: contract.id },
        type: { in: [InvoiceLineType.DAMAGE, InvoiceLineType.LOSS] },
      },
      select: { type: true, amountVnd: true },
    });
    expect(lines).toEqual(
      expect.arrayContaining([
        { type: InvoiceLineType.DAMAGE, amountVnd: 400_000n },
        { type: InvoiceLineType.LOSS, amountVnd: 2_500_000n },
      ]),
    );
    expect(
      await flow.codeOf(returns.close(contract.id, await flow.version(contract.id), flow.staff)),
    ).toBe(ErrorCode.BALANCE_OUTSTANDING);

    // Paid: the close check passes and the close succeeds.
    await flow.payAll(contract.id, at('2026-12-02T08:00:00.000Z'));
    check = await closeCheck(contract.id);
    expect(check.result).toMatchObject({ canClose: true, blockers: [] });
    const closed = await returns.close(contract.id, await flow.version(contract.id), flow.staff);
    expect(closed.status).toBe(ContractStatus.CLOSED);
    expect((await closeCheck(contract.id)).result).toMatchObject({ canClose: false, blockers: [] });

    // The units back: three AVAILABLE after the inspection; the damaged one after its maintenance
    // and intake check, with the next step shown on the device read at each stage (REQ-EVT-23).
    for (const deviceId of [passedA, passedB, passedC]) {
      expect(await statusOf(deviceId)).toBe(DeviceStatus.AVAILABLE);
    }
    expect((await devices.detail(damaged)).nextStep).toEqual({
      action: 'COMPLETE_MAINTENANCE',
      contractId: null,
    });
    const record = await flow.prisma.maintenanceRecord.findFirstOrThrow({
      where: { deviceId: damaged, status: MaintenanceStatus.OPEN },
    });
    const repairedAt = at('2026-12-03T02:00:00.000Z');
    await flow.prisma.$transaction((tx) =>
      flow.get(MaintenanceService).complete(
        damaged,
        record.id,
        {
          status: 'COMPLETED',
          resolution: 'Casing replaced',
          actualCostVnd: 0,
          expectedVersion: record.version,
        },
        flow.staff.id,
        repairedAt,
        tx,
      ),
    );
    expect((await devices.detail(damaged)).nextStep).toEqual({
      action: 'INTAKE',
      contractId: null,
    });
    const unit = await flow.prisma.device.findUniqueOrThrow({ where: { id: damaged } });
    await flow.prisma.$transaction((tx) =>
      flow
        .get(IntakeService)
        .record(
          damaged,
          { gpsFixOk: true, radioOk: true, batteryOk: true, expectedVersion: unit.version },
          flow.staff.id,
          at('2026-12-03T03:00:00.000Z'),
          tx,
        ),
    );
    expect(await statusOf(damaged)).toBe(DeviceStatus.AVAILABLE);
    expect((await devices.detail(damaged)).nextStep).toBeNull();
    // The lost unit stays out of the fleet.
    expect(await statusOf(missing)).toBe(DeviceStatus.RETIRED);
  });

  it('names the counter of the contract on the next step of a unit back but not yet inspected', async () => {
    const { contract, deviceIds, tags } = await flow.rented(5);
    await flow.prisma.rentalContract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.RETURN_DUE,
        returnDueAt: at('2026-12-02T02:00:00.000Z'),
        version: { increment: 1 },
      },
    });
    const back = at('2026-12-02T05:00:00.000Z');
    await returns.checkIn(contract.id, tags, flow.staff, back);
    expect((await devices.detail(deviceIds[0])).nextStep).toEqual({
      action: 'RESET',
      contractId: contract.id,
    });
    await flow.prisma.$transaction((tx) =>
      devices.reset(deviceIds[0], STEPS, flow.staff.id, back, tx),
    );
    expect((await devices.detail(deviceIds[0])).nextStep).toEqual({
      action: 'INSPECT',
      contractId: contract.id,
    });
    // Every unit is back: RETURNED, nothing owed beyond the paid term, so only the balance can block.
    const check = await returns.closeCheck(contract.id);
    expect(check.status).toBe(ContractStatus.RETURNED);
    expect(check.blockers.every((blocker) => blocker.code === 'BALANCE_OUTSTANDING')).toBe(true);
  });
});
