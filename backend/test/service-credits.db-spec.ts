import {
  InspectionResult,
  InvoiceKind,
  InvoiceLineType,
  ServiceCreditCause,
  ServiceCreditStatus,
} from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ServiceCreditService } from '../src/modules/billing/service-credit.service';
import { DevicesService } from '../src/modules/devices';
import { ContractDecisionsService } from '../src/modules/rentals/contract-decisions.service';
import { ReplacementService } from '../src/modules/rentals/replacement.service';
import { ReturnService } from '../src/modules/rentals/return.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, RentalFlow } from './db-rental-flow';

// A 1 x 1 PNG, the smallest signature the replacement accepts.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// The service credit acceptance criteria AC-06 to AC-08 against Postgres (billing task 8.1, design §9):
// a unit that fails mid-term, its replacement or check-in, the FAILED inspection, the request, the
// Admin decision with its separation of duty, the line on the next term invoice, and the refund after
// the close, through the real services of AppModule (test/db-rental-flow.ts). The term of a rented
// contract runs from 2 November 02:00 UTC to 2 December 02:00 UTC, 30 days.
describe('service credits against Postgres (AC-06 to AC-08)', () => {
  let flow: RentalFlow;
  let credits: ServiceCreditService;
  let returns: ReturnService;

  // Resets and inspects a unit that came back, FAILED, and returns the inspection id.
  const failedInspection = async (contractId: string, deviceId: string, when: Date) => {
    await flow.prisma.$transaction((tx) =>
      flow
        .get(DevicesService)
        .reset(
          deviceId,
          { keyRemoved: true, nodeDbCleared: true, ownerCleared: true },
          flow.staff.id,
          when,
          tx,
        ),
    );
    const { inspection } = await returns.inspect(
      contractId,
      deviceId,
      { result: InspectionResult.FAILED, damageCodes: [], note: 'Battery swollen' },
      flow.staff,
      when,
    );
    return inspection.id;
  };

  const rowOf = (contractId: string, deviceId: string) =>
    flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId, deviceId },
      orderBy: { reservedAt: 'asc' },
      select: { id: true },
    });

  // A running monthly contract whose first unit failed on day 10 (12 November) and was replaced on day
  // 13 (15 November) with its FAILED inspection recorded: the AC-06 setting.
  const replacedOnDay13 = async () => {
    const rented = await flow.rented(5);
    const [spare] = await flow.availableDevices(rented.variantId, 1);
    const { channelKeyVersion } = await flow.prisma.organization.findUniqueOrThrow({
      where: { id: rented.org.id },
    });
    const replacedAt = at('2026-11-15T02:00:00.000Z');
    await flow.get(ReplacementService).replace(
      rented.contract.id,
      rented.deviceIds[0],
      {
        replacementDeviceId: spare,
        keyVersion: channelKeyVersion,
        signatureImage: PNG,
        faultyPresent: true,
      },
      flow.staff,
      replacedAt,
    );
    const faultInspectionId = await failedInspection(
      rented.contract.id,
      rented.deviceIds[0],
      replacedAt,
    );
    const row = await rowOf(rented.contract.id, rented.deviceIds[0]);
    return { ...rented, faultInspectionId, contractDeviceId: row.id };
  };

  const request = (
    contractId: string,
    contractDeviceId: string,
    faultInspectionId: string,
    outageFrom: Date,
    actor: Caller,
    when: Date,
  ) =>
    credits.request(
      contractId,
      {
        contractDeviceId,
        cause: ServiceCreditCause.BATTERY_FAULT,
        faultInspectionId,
        outageFrom,
        outageSourceNote: 'The trek leader called the counter at 09:00',
      },
      actor,
      when,
    );

  const creditLines = (contractId: string) =>
    flow.prisma.invoiceLine.findMany({
      where: { invoice: { contractId }, type: InvoiceLineType.SERVICE_CREDIT },
      select: { amountVnd: true, serviceCreditId: true, invoice: { select: { kind: true } } },
    });

  beforeAll(async () => {
    flow = await compileRentalFlow();
    credits = flow.get(ServiceCreditService);
    returns = flow.get(ReturnService);
  });

  afterAll(async () => {
    await flow?.close();
  });

  it('AC-06: a battery failing on day 10 and replaced on day 13 credits 45,000 VND on the next term invoice', async () => {
    const { contract, contractDeviceId, faultInspectionId } = await replacedOnDay13();
    const requester = await flow.admin();
    const decider = await flow.admin();

    const requested = await request(
      contract.id,
      contractDeviceId,
      faultInspectionId,
      at('2026-11-12T02:00:00.000Z'),
      requester,
      at('2026-11-15T03:00:00.000Z'),
    );
    expect(requested).toMatchObject({
      status: ServiceCreditStatus.REQUESTED,
      outageTo: at('2026-11-15T02:00:00.000Z'),
      outageDays: 3,
      computedVnd: 45_000n,
    });
    // The same outage again is a duplicate (REQ-ERR-08).
    expect(
      await flow.codeOf(
        request(
          contract.id,
          contractDeviceId,
          faultInspectionId,
          at('2026-11-13T02:00:00.000Z'),
          requester,
          at('2026-11-15T04:00:00.000Z'),
        ),
      ),
    ).toBe('DUPLICATE_CREDIT');

    const approved = await credits.decide(
      requested.id,
      { decision: 'APPROVE', expectedVersion: requested.version },
      decider,
      at('2026-11-16T02:00:00.000Z'),
    );
    // A running monthly contract: the credit waits for the next term invoice.
    expect(approved).toMatchObject({ status: ServiceCreditStatus.APPROVED, decidedVnd: 45_000n });
    expect(await creditLines(contract.id)).toEqual([]);

    await flow.get(TermRolloverJob).run(at('2026-12-02T03:00:00.000Z'));

    expect(await creditLines(contract.id)).toEqual([
      { amountVnd: -45_000n, serviceCreditId: requested.id, invoice: { kind: InvoiceKind.TERM } },
    ]);
    const term2 = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id, term: { seq: 2 } },
      select: { totalVnd: true },
    });
    // 5 units at 450,000 VND less the credit
    expect(term2.totalVnd).toBe(2_250_000n - 45_000n);
    await expect(
      flow.prisma.serviceCredit.findUniqueOrThrow({ where: { id: requested.id } }),
    ).resolves.toMatchObject({ status: ServiceCreditStatus.APPLIED, appliedVnd: 45_000n });
  });

  it('AC-07: the requester cannot decide; another Admin reduces it to 30,000 VND and the line is -30,000', async () => {
    const { contract, contractDeviceId, faultInspectionId } = await replacedOnDay13();
    const requester = await flow.admin();
    const decider = await flow.admin();
    const requested = await request(
      contract.id,
      contractDeviceId,
      faultInspectionId,
      at('2026-11-12T02:00:00.000Z'),
      requester,
      at('2026-11-15T03:00:00.000Z'),
    );

    expect(
      await flow.codeOf(
        credits.decide(requested.id, { decision: 'APPROVE', expectedVersion: 1 }, requester),
      ),
    ).toBe('SEPARATION_OF_DUTY');
    const reduced = await credits.decide(
      requested.id,
      {
        decision: 'REDUCE',
        decidedVnd: 30_000,
        reason: 'The unit worked for part of day 10',
        expectedVersion: requested.version,
      },
      decider,
      at('2026-11-16T02:00:00.000Z'),
    );
    expect(reduced).toMatchObject({ status: ServiceCreditStatus.APPROVED, decidedVnd: 30_000n });

    await flow.get(TermRolloverJob).run(at('2026-12-02T03:00:00.000Z'));
    expect(await creditLines(contract.id)).toEqual([
      { amountVnd: -30_000n, serviceCreditId: requested.id, invoice: { kind: InvoiceKind.TERM } },
    ]);
  });

  it('AC-08: a requested credit blocks the close; credits not landed are REFUND_DUE, refunded once by reference', async () => {
    const { contract, org, deviceIds, tags } = await flow.rented(5);
    const requester = await flow.admin();
    const decider = await flow.admin();
    // Notice, the term end, every unit back three hours after it.
    await flow
      .get(ContractDecisionsService)
      .giveNotice(
        contract.id,
        await flow.version(contract.id),
        org.manager,
        at('2026-11-10T02:00:00.000Z'),
      );
    await flow.get(TermRolloverJob).run(at('2026-12-02T03:00:00.000Z'));
    const back = at('2026-12-02T05:00:00.000Z');
    await returns.checkIn(contract.id, tags, flow.staff, back);
    const first = await failedInspection(contract.id, deviceIds[0], back);
    const second = await failedInspection(contract.id, deviceIds[1], back);
    await flow.payAll(contract.id);

    // Day 26 to the term end: 4 days, 60,000 VND.
    const blocking = await request(
      contract.id,
      (await rowOf(contract.id, deviceIds[0])).id,
      first,
      at('2026-11-28T02:00:00.000Z'),
      requester,
      back,
    );
    expect(blocking).toMatchObject({
      outageTo: at('2026-12-02T02:00:00.000Z'),
      outageDays: 4,
      computedVnd: 60_000n,
    });
    const check = await returns.closeCheck(contract.id, back);
    expect(check.canClose).toBe(false);
    expect(check.blockers).toEqual([
      expect.objectContaining({ code: 'SERVICE_CREDIT_PENDING', serviceCreditId: blocking.id }),
    ]);
    expect(
      await flow.codeOf(returns.close(contract.id, await flow.version(contract.id), flow.staff)),
    ).toBe('INVALID_STATE_TRANSITION');

    // Decided before the close with no invoice to land on, it turns REFUND_DUE with the close.
    await credits.decide(
      blocking.id,
      { decision: 'APPROVE', expectedVersion: blocking.version },
      decider,
      back,
    );
    await returns.close(contract.id, await flow.version(contract.id), flow.staff);
    await expect(
      flow.prisma.serviceCredit.findUniqueOrThrow({ where: { id: blocking.id } }),
    ).resolves.toMatchObject({ status: ServiceCreditStatus.REFUND_DUE, appliedVnd: 0n });

    // Requested and decided after the close, it is REFUND_DUE at once.
    const late = await request(
      contract.id,
      (await rowOf(contract.id, deviceIds[1])).id,
      second,
      at('2026-11-30T02:00:00.000Z'),
      requester,
      at('2026-12-03T02:00:00.000Z'),
    );
    const decidedLate = await credits.decide(
      late.id,
      { decision: 'APPROVE', expectedVersion: late.version },
      decider,
      at('2026-12-03T03:00:00.000Z'),
    );
    expect(decidedLate.status).toBe(ServiceCreditStatus.REFUND_DUE);
    expect(await creditLines(contract.id)).toEqual([]);

    const reference = `FT${flow.next()}`;
    await expect(
      credits.recordRefund(blocking.id, reference, flow.staff, at('2026-12-04T02:00:00.000Z')),
    ).resolves.toMatchObject({ status: ServiceCreditStatus.REFUNDED, refundReference: reference });
    expect(await flow.codeOf(credits.recordRefund(late.id, reference, flow.staff))).toBe(
      'DUPLICATE_REFERENCE',
    );
  });
});
