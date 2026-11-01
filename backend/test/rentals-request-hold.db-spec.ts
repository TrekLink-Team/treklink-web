import { ContractStatus, DeviceStatus, InvoiceLineType, PlanType } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
import {
  ContractDecisionsService,
  HOLD_EXPIRED,
} from '../src/modules/rentals/contract-decisions.service';
import { ContractsService } from '../src/modules/rentals/contracts.service';
import { RequestHoldExpiryJob } from '../src/modules/rentals/request-hold-expiry.job';
import { at, compileRentalFlow, RentalFlow, START_DATE, TERM_START } from './db-rental-flow';

const HOUR_MS = 3_600_000;
// 10:00 on 1 November in UTC+7, the day before START_DATE.
const REQUEST_AT = at('2026-11-01T03:00:00.000Z');

// D-092 rule 1 against Postgres (rentals task 2.7, AC-08, AC-09, design §2.1): a request holds its
// units in its own transaction, two requests for the last units are settled first come, first
// served, and an unpaid hold expires through rentals.requestHoldExpiry while a paid one is kept
// until Staff decide. The legacy approval of a contract that holds nothing stays in
// rentals-acceptance.db-spec.ts (AC-01). Run only through test:db against a migrated database.
describe('rentals: availability and a hold at request, on Postgres (D-092)', () => {
  let flow: RentalFlow;
  let contracts: ContractsService;
  let decisions: ContractDecisionsService;
  let job: RequestHoldExpiryJob;
  let holdHours: number;

  beforeAll(async () => {
    flow = await compileRentalFlow();
    contracts = flow.get(ContractsService);
    decisions = flow.get(ContractDecisionsService);
    job = flow.get(RequestHoldExpiryJob);
    const seeded = await flow.seededParameters([
      'rentals.requestHoldHours',
      'rentals.minOrderQuantity',
    ]);
    expect(seeded).toEqual({ 'rentals.requestHoldHours': 24, 'rentals.minOrderQuantity': 5 });
    holdHours = seeded['rentals.requestHoldHours'] as number;
  });

  afterAll(async () => {
    await flow?.close();
  });

  // A variant priced at 450,000 VND a month from January, with `units` AVAILABLE devices.
  const pricedVariant = async (units: number) => {
    const variantId = await flow.variant();
    await flow.prisma.priceSchedule.create({
      data: {
        hardwareVariantId: variantId,
        monthlyPriceVnd: 450_000n,
        effectiveFrom: at('2026-01-01T00:00:00.000Z'),
        createdById: flow.staff.id,
      },
    });
    const deviceIds = await flow.availableDevices(variantId, units);
    return { variantId, deviceIds };
  };

  const request = (manager: Caller, variantId: string, quantity = 5) =>
    contracts.request(
      {
        planType: PlanType.MONTHLY,
        hardwareVariantId: variantId,
        quantity,
        requestedStartDate: START_DATE,
      },
      manager,
      REQUEST_AT,
    );

  const liveRows = (contractId: string) =>
    flow.prisma.contractDevice.findMany({
      where: { contractId, releasedAt: null },
      select: { deviceId: true },
    });

  const statuses = async (deviceIds: string[]) =>
    (
      await flow.prisma.device.findMany({
        where: { id: { in: deviceIds } },
        select: { status: true },
      })
    ).map((device) => device.status);

  it('holds the units, opens term 1 and issues the first invoice with the request', async () => {
    const org = await flow.organization();
    const { variantId, deviceIds } = await pricedVariant(6);

    const requested = await request(org.manager, variantId);

    expect(requested.heldDevices).toBe(5);
    expect(requested.holdExpiresAt).toEqual(new Date(REQUEST_AT.getTime() + holdHours * HOUR_MS));
    const row = await flow.prisma.rentalContract.findUniqueOrThrow({
      where: { id: requested.contract.id },
    });
    expect(row.status).toBe(ContractStatus.REQUESTED);
    expect(row.holdExpiresAt).toEqual(requested.holdExpiresAt);
    expect((await liveRows(requested.contract.id)).length).toBe(5);
    expect((await statuses(deviceIds)).sort()).toEqual([
      DeviceStatus.AVAILABLE,
      ...Array<DeviceStatus>(5).fill(DeviceStatus.RESERVED),
    ]);
    const invoice = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: requested.contract.id },
      include: { lines: { orderBy: { seq: 'asc' } } },
    });
    // The deposit: 5 x 450,000 VND x 0.5, due at the term start; the balance at the term end.
    expect(invoice.lines.map((line) => [line.type, line.amountVnd])).toEqual([
      [InvoiceLineType.HOLDING_FEE, 1_125_000n],
      [InvoiceLineType.TERM_BALANCE, 1_125_000n],
    ]);
    expect(invoice.lines[0].dueAt).toEqual(TERM_START);
  });

  it('AC-08: of two requests for the last 5 units at once, one holds them and the other creates nothing', async () => {
    const first = await flow.organization();
    const second = await flow.organization();
    const { variantId, deviceIds } = await pricedVariant(5);

    const outcomes = await Promise.all([
      flow.codeOf(request(first.manager, variantId)),
      flow.codeOf(request(second.manager, variantId)),
    ]);

    expect([...outcomes].sort()).toEqual([ErrorCode.INSUFFICIENT_DEVICES, null].sort());
    const [winner, loser] = outcomes[0] === null ? [first, second] : [second, first];
    // The loser left no contract, row, term or invoice behind.
    expect(await flow.prisma.rentalContract.count({ where: { organizationId: loser.id } })).toBe(0);
    expect(await flow.prisma.invoice.count({ where: { organizationId: loser.id } })).toBe(0);
    const won = await flow.prisma.rentalContract.findFirstOrThrow({
      where: { organizationId: winner.id },
    });
    expect(new Set((await liveRows(won.id)).map((row) => row.deviceId))).toEqual(
      new Set(deviceIds),
    );
    expect(await statuses(deviceIds)).toEqual(Array(5).fill(DeviceStatus.RESERVED));
  });

  it('refuses a quantity above the available count with 409 and changes nothing (REQ-ERR-01)', async () => {
    const org = await flow.organization();
    const { variantId, deviceIds } = await pricedVariant(4);
    expect(await flow.codeOf(request(org.manager, variantId))).toBe(ErrorCode.INSUFFICIENT_DEVICES);
    expect(await flow.prisma.rentalContract.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await statuses(deviceIds)).toEqual(Array(4).fill(DeviceStatus.AVAILABLE));
  });

  it('AC-09: an unpaid hold expires, releasing the units and voiding the unpaid lines; a re-run changes nothing', async () => {
    const org = await flow.organization();
    const { variantId, deviceIds } = await pricedVariant(5);
    const { contract, holdExpiresAt } = await request(org.manager, variantId);

    // Just before the expiry nothing moves.
    await job.run(new Date(holdExpiresAt.getTime() - 60_000));
    expect(await flow.status(contract.id)).toBe(ContractStatus.REQUESTED);

    await job.run(new Date(holdExpiresAt.getTime() + 60_000));
    const row = await flow.prisma.rentalContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.status).toBe(ContractStatus.CANCELLED);
    expect(row.cancelReason).toBe(HOLD_EXPIRED);
    const transition = await flow.prisma.contractTransition.findFirstOrThrow({
      where: { contractId: contract.id, toStatus: ContractStatus.CANCELLED },
    });
    expect(transition).toMatchObject({ actorId: null, reason: HOLD_EXPIRED });
    expect(await liveRows(contract.id)).toEqual([]);
    expect(await statuses(deviceIds)).toEqual(Array(5).fill(DeviceStatus.AVAILABLE));
    const adjustment = await flow.prisma.invoiceLine.findFirstOrThrow({
      where: { invoice: { contractId: contract.id }, type: InvoiceLineType.ADJUSTMENT },
    });
    expect(adjustment.amountVnd).toBe(-2_250_000n);

    await job.run(new Date(holdExpiresAt.getTime() + 2 * 60_000));
    expect(
      await flow.prisma.contractTransition.count({
        where: { contractId: contract.id, toStatus: ContractStatus.CANCELLED },
      }),
    ).toBe(1);
  });

  it('AC-09: a paid hold is kept past the expiry, and approval keeps the same units and invoice', async () => {
    const org = await flow.organization();
    const { variantId, deviceIds } = await pricedVariant(5);
    const { contract, holdExpiresAt } = await request(org.manager, variantId);
    const invoice = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id },
      include: { lines: { orderBy: { seq: 'asc' } } },
    });
    // Staff record the deposit at the counter (billing REQ-EVT-10).
    await flow.payAll(contract.id, new Date(REQUEST_AT.getTime() + HOUR_MS));

    await job.run(new Date(holdExpiresAt.getTime() + 60_000));
    expect(await flow.status(contract.id)).toBe(ContractStatus.REQUESTED);
    expect(await statuses(deviceIds)).toEqual(Array(5).fill(DeviceStatus.RESERVED));

    const approved = await decisions.approve(
      contract.id,
      {
        // The counter appointment, after the approval time (REQ-ERR-09).
        handoverAt: new Date(holdExpiresAt.getTime() + HOUR_MS),
        expectedVersion: await flow.version(contract.id),
      },
      flow.staff,
      new Date(holdExpiresAt.getTime() + 2 * 60_000),
    );
    expect(approved.contract.status).toBe(ContractStatus.APPROVED);
    expect(new Set(approved.devices.map((device) => device.id))).toEqual(new Set(deviceIds));
    expect(await flow.prisma.contractTerm.count({ where: { contractId: contract.id } })).toBe(1);
    expect(await flow.prisma.invoice.findMany({ where: { contractId: contract.id } })).toEqual([
      expect.objectContaining({ id: invoice.id }),
    ]);
  });

  it('rejection releases the held units, voids the unpaid lines and answers the paid deposit', async () => {
    const org = await flow.organization();
    const { variantId, deviceIds } = await pricedVariant(5);
    const { contract } = await request(org.manager, variantId);

    const rejected = await decisions.reject(
      contract.id,
      { reason: 'Variant withdrawn', expectedVersion: await flow.version(contract.id) },
      flow.staff,
      new Date(REQUEST_AT.getTime() + HOUR_MS),
    );

    expect(rejected.contract.status).toBe(ContractStatus.REJECTED);
    expect(rejected.paidVnd).toBe(0n);
    expect(await liveRows(contract.id)).toEqual([]);
    expect(await statuses(deviceIds)).toEqual(Array(5).fill(DeviceStatus.AVAILABLE));
    const adjustment = await flow.prisma.invoiceLine.findFirstOrThrow({
      where: { invoice: { contractId: contract.id }, type: InvoiceLineType.ADJUSTMENT },
    });
    expect(adjustment.amountVnd).toBe(-2_250_000n);
  });
});
