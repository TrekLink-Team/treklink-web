import {
  ContractStatus,
  DeviceStatus,
  IncidentConfidence,
  IncidentSource,
  InvoiceLineType,
  LossCustody,
  LossDecision,
  OrganizationStatus,
} from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { LossCaseView } from '../src/modules/devices';
import { RentalsLossCaseListener } from '../src/modules/rentals/providers/loss-case-listener.provider';
import { ContractDecisionsService } from '../src/modules/rentals/contract-decisions.service';
import { HandoverService } from '../src/modules/rentals/handover.service';
import { OverdueAndDefaultJob } from '../src/modules/rentals/overdue-and-default.job';
import { ReturnService } from '../src/modules/rentals/return.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, DAY_MS, RentalFlow } from './db-rental-flow';

// The rentals acceptance criteria AC-01 to AC-07 against Postgres (rentals task 6.2, with 2.2, 2.3,
// 2.4, 3.1, 3.2, 4.1 and 4.4), and the 50 parallel approvals of the non-functional table, through
// the real services of AppModule (test/db-rental-flow.ts). The jobs are called with explicit times.
// Run only through test:db against a migrated disposable database.
describe('rentals acceptance against Postgres (AC-01 to AC-07)', () => {
  let flow: RentalFlow;
  let decisions: ContractDecisionsService;
  let handover: HandoverService;
  let returns: ReturnService;
  let rollover: TermRolloverJob;
  let overdueJob: OverdueAndDefaultJob;

  beforeAll(async () => {
    flow = await compileRentalFlow();
    decisions = flow.get(ContractDecisionsService);
    handover = flow.get(HandoverService);
    returns = flow.get(ReturnService);
    rollover = flow.get(TermRolloverJob);
    overdueJob = flow.get(OverdueAndDefaultJob);
    const expected = {
      'rentals.returnGraceHours': 24,
      'rentals.defaultAfterDays': 7,
      'rentals.termRolloverHourLocal': 9,
      'billing.lateFeePerDevicePerDayVnd': 50_000,
      'devices.handoverMinBatteryPct': 50,
    };
    expect(await flow.seededParameters(Object.keys(expected))).toEqual(expected);
  });

  afterAll(async () => {
    await flow?.close();
  });

  it('AC-01: of two concurrent approvals for the last 5 units, one wins and the other reserves nothing', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    const deviceIds = await flow.availableDevices(variantId, 5);
    const first = await flow.requested(org.id, org.manager.id, variantId, 5);
    const second = await flow.requested(org.id, org.manager.id, variantId, 5);

    const codes = await Promise.all([
      flow.codeOf(flow.approve(first.id)),
      flow.codeOf(flow.approve(second.id)),
    ]);

    // One approval went through (no code), the other answered INSUFFICIENT_DEVICES.
    expect([...codes].sort()).toEqual([ErrorCode.INSUFFICIENT_DEVICES, null].sort());
    const loser = codes[0] === null ? second : first;
    expect(await flow.status(loser.id)).toBe(ContractStatus.REQUESTED);
    expect(await flow.prisma.contractDevice.count({ where: { contractId: loser.id } })).toBe(0);
    expect(
      await flow.prisma.device.count({
        where: { id: { in: deviceIds }, status: DeviceStatus.RESERVED },
      }),
    ).toBe(5);
  });

  it('never over-allocates a variant across 50 parallel approvals (non-functional table, E01-1)', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    const deviceIds = await flow.availableDevices(variantId, 12);
    const contracts = [];
    for (let index = 0; index < 50; index += 1) {
      contracts.push(await flow.requested(org.id, org.manager.id, variantId, 5));
    }

    const codes = await Promise.all(
      contracts.map((contract) => flow.codeOf(flow.approve(contract.id))),
    );

    const won = codes.filter((code) => code === null).length;
    const refused: string = ErrorCode.INSUFFICIENT_DEVICES;
    expect(codes.filter((code) => code !== null && code !== refused)).toEqual([]);
    // 12 units hold two contracts of 5 at most; the units left over stay AVAILABLE.
    expect(won).toBeLessThanOrEqual(2);
    expect(won).toBeGreaterThanOrEqual(1);
    const reservedRows = await flow.prisma.contractDevice.count({
      where: { contractId: { in: contracts.map((contract) => contract.id) } },
    });
    expect(reservedRows).toBe(won * 5);
    expect(
      await flow.prisma.device.count({
        where: { id: { in: deviceIds }, status: DeviceStatus.RESERVED },
      }),
    ).toBe(won * 5);
  }, 120_000);

  it('swaps a failing unit for a spare, and with no spare left refuses and changes nothing (rentals 2.3, E01-5)', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    const [first, second, spare] = await flow.availableDevices(variantId, 3);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 2);
    await flow.approve(contract.id);
    const swapAt = at('2026-11-02T01:30:00.000Z');

    const swapped = await handover.swap(contract.id, first, 'No GPS fix', flow.staff, swapAt);
    expect(swapped.reserved.id).toBe(spare);

    expect(
      await flow.codeOf(handover.swap(contract.id, second, 'Cracked case', flow.staff, swapAt)),
    ).toBe(ErrorCode.INSUFFICIENT_DEVICES);
    const live = await flow.prisma.contractDevice.findMany({
      where: { contractId: contract.id, releasedAt: null },
      select: { deviceId: true },
    });
    expect(new Set(live.map((row) => row.deviceId))).toEqual(new Set([second, spare]));
    const devices = await flow.prisma.device.findMany({
      where: { id: { in: [first, second, spare] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(devices.map((device) => [device.id, device.status]))).toEqual({
      [first]: DeviceStatus.MAINTENANCE,
      [second]: DeviceStatus.RESERVED,
      [spare]: DeviceStatus.RESERVED,
    });
  });

  it('AC-02: a handover without the confirmed holding fee is 409 FIRST_PAYMENT_MISSING and stays APPROVED', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    const deviceIds = await flow.availableDevices(variantId, 5);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
    await flow.approve(contract.id);

    expect(await flow.codeOf(flow.handOver(contract.id, org.manager.id, deviceIds))).toBe(
      ErrorCode.FIRST_PAYMENT_MISSING,
    );
    expect(await flow.status(contract.id)).toBe(ContractStatus.APPROVED);
    expect(
      await flow.prisma.contractDevice.count({
        where: { contractId: contract.id, handedOverAt: { not: null } },
      }),
    ).toBe(0);

    // Paid, the same handover goes through.
    await flow.payAll(contract.id, at('2026-10-27T02:00:00.000Z'));
    await flow.handOver(contract.id, org.manager.id, deviceIds);
    expect(await flow.status(contract.id)).toBe(ContractStatus.ACTIVE);
  });

  it('AC-03: a monthly contract with no notice rolls into term 2, the term-1 balance and term-2 holding fee due together', async () => {
    const { contract } = await flow.rented(5);
    const termEnd = at('2026-12-02T02:00:00.000Z');

    await rollover.run(at('2026-12-02T03:00:00.000Z'));

    const terms = await flow.prisma.contractTerm.findMany({
      where: { contractId: contract.id },
      orderBy: { seq: 'asc' },
    });
    expect(terms.map((term) => [term.seq, term.startsAt, term.endsAt])).toEqual([
      [1, at('2026-11-02T02:00:00.000Z'), termEnd],
      [2, termEnd, at('2027-01-02T02:00:00.000Z')],
    ]);
    const lines = await flow.prisma.invoiceLine.findMany({
      where: { invoice: { contractId: contract.id } },
      select: { type: true, amountVnd: true, dueAt: true, invoice: { select: { termId: true } } },
    });
    const termOne = lines.filter((line) => line.invoice.termId === terms[0].id);
    const termTwo = lines.filter((line) => line.invoice.termId === terms[1].id);
    const balanceOne = termOne.find((line) => line.type === InvoiceLineType.TERM_BALANCE);
    const holdingTwo = termTwo.find((line) => line.type === InvoiceLineType.HOLDING_FEE);
    expect(balanceOne).toMatchObject({ amountVnd: 1_125_000n, dueAt: termEnd });
    expect(holdingTwo).toMatchObject({ amountVnd: 1_125_000n, dueAt: termEnd });
    expect(await flow.status(contract.id)).toBe(ContractStatus.ACTIVE);

    // A re-run after downtime finds term 1 closed and opens nothing more (REQ-UBI-03).
    await rollover.run(at('2026-12-02T04:00:00.000Z'));
    expect(await flow.prisma.contractTerm.count({ where: { contractId: contract.id } })).toBe(2);
  });

  it('AC-04, AC-06, AC-07: overdue, a late line per device, a close refused while an incident is open, then labels erased', async () => {
    const { contract, org, deviceIds, tags } = await flow.rented(5);
    for (const [index, deviceId] of deviceIds.entries()) {
      await decisions.setHolder(
        contract.id,
        deviceId,
        { name: `Hiker ${index}`, phone: null, emergencyContact: null },
        org.manager,
      );
    }
    await decisions.giveNotice(
      contract.id,
      await flow.version(contract.id),
      org.manager,
      at('2026-11-10T02:00:00.000Z'),
    );
    const due = at('2026-12-02T02:00:00.000Z');

    // Term end: RETURN_DUE at the term end; past the 24 h grace: OVERDUE.
    await rollover.run(at('2026-12-02T03:00:00.000Z'));
    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURN_DUE);
    await overdueJob.run(at('2026-12-03T03:00:00.000Z'));
    expect(await flow.status(contract.id)).toBe(ContractStatus.OVERDUE);

    // Back 3 days after the due time, past the grace: one late line of 3 started days per device
    // (REQ-EVT-04 of billing counts from returnDueAt, billing design Figure 16).
    const back = new Date(due.getTime() + 3 * DAY_MS);
    await returns.checkIn(contract.id, tags, flow.staff, back);
    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURNED);
    const late = await flow.prisma.invoiceLine.findMany({
      where: { invoice: { contractId: contract.id }, type: InvoiceLineType.LATE_FEE },
    });
    expect(late).toHaveLength(5);
    for (const line of late) {
      expect(line).toMatchObject({ quantity: 3, unitVnd: 50_000n, amountVnd: 150_000n });
    }
    expect(new Set(late.map((line) => line.deviceId))).toEqual(new Set(deviceIds));

    // AC-06: everything paid, an incident still open on one device blocks the close.
    await flow.payAll(contract.id, back);
    const incident = await flow.prisma.incident.create({
      data: {
        code: `INC-RA-${flow.next()}`,
        deviceId: deviceIds[0],
        contractId: contract.id,
        organizationId: org.id,
        source: IncidentSource.DEVICE_SOS,
        confidence: IncidentConfidence.CONFIRMED,
        firstEventAt: at('2026-11-20T02:00:00.000Z'),
        lastEventAt: at('2026-11-20T02:00:00.000Z'),
      },
    });
    expect(
      await flow.codeOf(returns.close(contract.id, await flow.version(contract.id), flow.staff)),
    ).toBe(ErrorCode.OPEN_INCIDENTS);
    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURNED);

    // AC-07: with the incident closed, the contract closes and every holder label is erased.
    await flow.prisma.incident.update({
      where: { id: incident.id },
      data: { state: 'CLOSED', closedAt: back },
    });
    await returns.close(contract.id, await flow.version(contract.id), flow.staff);
    expect(await flow.status(contract.id)).toBe(ContractStatus.CLOSED);
    const rows = await flow.prisma.contractDevice.findMany({ where: { contractId: contract.id } });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row).toMatchObject({
        holderName: null,
        holderPhone: null,
        holderEmergencyContact: null,
      });
    }
  });

  it('AC-05: OVERDUE for rentals.defaultAfterDays turns DEFAULTED and suspends the organization', async () => {
    const { contract, org } = await flow.rented(5);
    await decisions.giveNotice(
      contract.id,
      await flow.version(contract.id),
      org.manager,
      at('2026-11-10T02:00:00.000Z'),
    );
    await rollover.run(at('2026-12-02T03:00:00.000Z'));
    await overdueJob.run(at('2026-12-03T03:00:00.000Z'));
    expect(await flow.status(contract.id)).toBe(ContractStatus.OVERDUE);

    // Six days later the default threshold (7 days) has not passed.
    await overdueJob.run(at('2026-12-09T03:00:00.000Z'));
    expect(await flow.status(contract.id)).toBe(ContractStatus.OVERDUE);

    await overdueJob.run(at('2026-12-10T03:00:00.000Z'));
    expect(await flow.status(contract.id)).toBe(ContractStatus.DEFAULTED);
    expect(
      (await flow.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).status,
    ).toBe(OrganizationStatus.SUSPENDED);
  });

  // rentals 1.3 (review of #152): onSettled ends the row's interval at the confirmation time inside
  // the loss-case transaction, so a settlement that fails later rolls lostAt back with it.
  it('sets lostAt in the caller transaction on settlement, and rolls it back with that transaction', async () => {
    const { contract, org, deviceIds } = await flow.rented(5);
    const row = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: contract.id, deviceId: deviceIds[0] },
    });
    const device = await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceIds[0] } });
    const confirmedAt = at('2026-11-20T03:00:00.000Z');
    const view: LossCaseView = {
      id: 'loss-case',
      code: `LOSS-${flow.next()}`,
      deviceId: device.id,
      assetTag: device.assetTag,
      custody: LossCustody.RENTER,
      custodyContract: {
        contractId: contract.id,
        organizationId: org.id,
        contractDeviceId: row.id,
      },
      confirmedAt,
      chargeVnd: null,
      decisionReason: null,
      decidedById: null,
    };
    const listener = flow.get(RentalsLossCaseListener);
    const lostAt = async () =>
      (await flow.prisma.contractDevice.findUniqueOrThrow({ where: { id: row.id } })).lostAt;

    const failure = new Error('settlement failed after the listeners');
    await expect(
      flow.prisma.$transaction(async (tx) => {
        await listener.onSettled(view, LossDecision.CHARGED, tx);
        const inside = await tx.contractDevice.findUniqueOrThrow({ where: { id: row.id } });
        expect(inside.lostAt).toEqual(confirmedAt);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await lostAt()).toBeNull();

    await flow.prisma.$transaction((tx) => listener.onSettled(view, LossDecision.CHARGED, tx));
    expect(await lostAt()).toEqual(confirmedAt);
  });
});
