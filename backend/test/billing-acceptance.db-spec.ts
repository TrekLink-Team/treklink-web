import {
  DamageChargeStatus,
  InspectionResult,
  InvoiceKind,
  InvoiceLineType,
  LossCustody,
  PaymentMethod,
  PaymentStatus,
  PlanType,
} from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { BalanceService } from '../src/modules/billing/balance.service';
import { DamageChargeService } from '../src/modules/billing/damage-charge.service';
import { PaymentsService } from '../src/modules/billing/payments.service';
import { BillingLossCaseListener } from '../src/modules/billing/providers/loss-case-listener.provider';
import { SepayService } from '../src/modules/billing/sepay.service';
import { DevicesService } from '../src/modules/devices';
import { OrganizationStatusService } from '../src/modules/organizations/organization-status.service';
import { ContractDecisionsService } from '../src/modules/rentals/contract-decisions.service';
import { ReturnService } from '../src/modules/rentals/return.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, RentalFlow, TERM_START } from './db-rental-flow';

// The billing acceptance criteria AC-01 to AC-05 against Postgres (billing tasks 5.2, 3.1 and 3.2):
// the term and day-plan invoices, the SePay webhook delivered 10 times at once, the damage approval
// with its separation of duty, the loss charge from the remaining-value schedule, and two counter
// payments racing on one invoice, through the real services of AppModule (test/db-rental-flow.ts).
// Run only through test:db against a migrated disposable database.
describe('billing acceptance against Postgres (AC-01 to AC-05)', () => {
  let flow: RentalFlow;
  let payments: PaymentsService;
  let sepay: SepayService;
  let damage: DamageChargeService;
  let returns: ReturnService;

  const linesOf = (contractId: string) =>
    flow.prisma.invoiceLine.findMany({
      where: { invoice: { contractId } },
      orderBy: [{ dueAt: 'asc' }, { seq: 'asc' }],
      select: { type: true, amountVnd: true, dueAt: true, invoice: { select: { kind: true } } },
    });

  // An APPROVED contract with its first invoice issued.
  const approved = async (quantity: number, terms: Parameters<RentalFlow['requested']>[4] = {}) => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    await flow.availableDevices(variantId, quantity);
    const contract = await flow.requested(org.id, org.manager.id, variantId, quantity, terms);
    await flow.approve(contract.id);
    return { contract, org };
  };

  beforeAll(async () => {
    flow = await compileRentalFlow();
    payments = flow.get(PaymentsService);
    sepay = flow.get(SepayService);
    damage = flow.get(DamageChargeService);
    returns = flow.get(ReturnService);
    const expected = {
      'billing.damageApprovalThresholdVnd': 500_000,
      'rentals.returnGraceHours': 24,
      'rentals.termRolloverHourLocal': 9,
      'billing.sepayPaymentTtlMinutes': 30,
    };
    expect(await flow.seededParameters(Object.keys(expected))).toEqual(expected);
  });

  afterAll(async () => {
    await flow?.close();
  });

  it('AC-01: 10 units at 450,000 VND monthly invoice 4,500,000, half at the term start and half at its end', async () => {
    const { contract } = await approved(10);

    const invoices = await flow.prisma.invoice.findMany({ where: { contractId: contract.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ kind: InvoiceKind.TERM, totalVnd: 4_500_000n });
    expect(await linesOf(contract.id)).toEqual([
      expect.objectContaining({
        type: InvoiceLineType.HOLDING_FEE,
        amountVnd: 2_250_000n,
        dueAt: TERM_START,
      }),
      expect.objectContaining({
        type: InvoiceLineType.TERM_BALANCE,
        amountVnd: 2_250_000n,
        dueAt: at('2026-12-02T02:00:00.000Z'),
      }),
    ]);
  });

  it('AC-02: a 4-day plan of 8 units at premium 1.5 is 720,000 VND due at handover', async () => {
    const { contract } = await approved(8, {
      planType: PlanType.DAY,
      dayPlanDays: 4,
      dayPremium: '1.5',
    });

    const lines = await linesOf(contract.id);
    expect(lines).toEqual([
      expect.objectContaining({
        type: InvoiceLineType.DAY_PLAN_FEE,
        amountVnd: 720_000n,
        dueAt: TERM_START,
      }),
    ]);
  });

  it('reports revenue per variant by the due time of each line (billing task 2.4)', async () => {
    // Two monthly contracts of one variant, 2 units and 1 unit at 450,000 VND: the holding fees are
    // due at the term start on 2 November, the term balances at its end on 2 December. Only the
    // first contract is paid, in full, before the start.
    const org = await flow.organization();
    const variantId = await flow.variant();
    await flow.availableDevices(variantId, 3);
    const paid = await flow.requested(org.id, org.manager.id, variantId, 2);
    const unpaid = await flow.requested(org.id, org.manager.id, variantId, 1);
    await flow.approve(paid.id);
    await flow.approve(unpaid.id);
    await flow.payAll(paid.id);
    const { code } = await flow.prisma.hardwareVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    const balances = flow.get(BalanceService);
    const rowOf = async (from: string, to: string | Date) =>
      (await balances.revenue({ from: at(from), to: typeof to === 'string' ? at(to) : to })).find(
        (row) => row.hardwareVariantId === variantId,
      );

    await expect(rowOf('2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z')).resolves.toEqual({
      hardwareVariantId: variantId,
      variantCode: code,
      invoicedVnd: 675_000n,
      paidVnd: 450_000n,
      outstandingVnd: 225_000n,
    });
    await expect(rowOf('2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')).resolves.toEqual({
      hardwareVariantId: variantId,
      variantCode: code,
      invoicedVnd: 675_000n,
      paidVnd: 450_000n,
      outstandingVnd: 225_000n,
    });
    // The end is exclusive: a range ending at the stored term end leaves the term balances out.
    const { endsAt } = await flow.prisma.contractTerm.findFirstOrThrow({
      where: { contractId: paid.id, seq: 1 },
    });
    await expect(rowOf('2026-11-01T00:00:00.000Z', endsAt)).resolves.toMatchObject({
      invoicedVnd: 675_000n,
    });
  });

  it('AC-03: the same SePay webhook posted 10 times at once records one payment', async () => {
    const { contract, org } = await approved(5);
    const invoice = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id },
    });
    const request = await sepay.request(
      invoice.id,
      undefined,
      org.manager,
      at('2026-10-27T02:00:00.000Z'),
    );
    const hook = {
      id: `sepay-${flow.next()}`,
      transferType: 'in',
      transferAmount: Number(request.amountVnd),
      content: `${request.reference} thanh toan`,
    };

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        sepay.handleWebhook('Apikey db-sepay-webhook-key', hook, at('2026-10-27T02:05:00.000Z')),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === 'confirmed')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome !== 'confirmed')).toEqual(
      Array.from({ length: 9 }, () => 'duplicate'),
    );
    const recorded = await flow.prisma.payment.findMany({
      where: { contractId: contract.id, method: PaymentMethod.SEPAY },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ status: PaymentStatus.CONFIRMED, gatewayTxnId: hook.id });
    const paid = await flow.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(paid.paidVnd).toBe(request.amountVnd);
  });

  it('applies one of two counter payments racing for what an invoice owes, and refuses the other (billing 3.1)', async () => {
    const { contract } = await approved(5);
    const invoice = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id },
    });
    const owed = invoice.totalVnd;
    const pay = (reference: string) =>
      flow.codeOf(
        payments.recordCounter(
          invoice.id,
          { method: PaymentMethod.CASH, amountVnd: owed, reference },
          flow.staff,
          at('2026-10-27T02:00:00.000Z'),
        ),
      );

    const codes = await Promise.all([pay(`C1-${flow.next()}`), pay(`C2-${flow.next()}`)]);

    expect([...codes].sort()).toEqual([ErrorCode.OVERPAYMENT, null].sort());
    const after = await flow.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.paidVnd).toBe(owed);
    expect(
      await flow.prisma.payment.count({
        where: { invoiceId: invoice.id, method: PaymentMethod.CASH },
      }),
    ).toBe(1);

    // One reference sent twice at once records one payment; the other is 409 (E01-6).
    const second = await approved(5);
    const other = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: second.contract.id },
    });
    const reference = `DUP-${flow.next()}`;
    const duplicate = await Promise.all(
      [other.id, other.id].map((id) =>
        flow.codeOf(
          payments.recordCounter(
            id,
            { method: PaymentMethod.CASH, amountVnd: 1_000n, reference },
            flow.staff,
            at('2026-10-27T02:00:00.000Z'),
          ),
        ),
      ),
    );
    expect([...duplicate].sort()).toEqual([ErrorCode.DUPLICATE_REFERENCE, null].sort());
  });

  it("AC-04: a 700,000 VND damage over the 500,000 threshold waits for an Admin, and the inspector's own decision is 403", async () => {
    const { contract, deviceIds, tags, org } = await flow.rented(5);
    const inspector = await flow.admin();
    const codes = [`CASE-${flow.next()}`, `ANTENNA-${flow.next()}`];
    for (const [index, code] of codes.entries()) {
      await flow.prisma.damageRate.create({
        data: {
          code,
          label: `Damage ${index}`,
          amountVnd: index === 0 ? 400_000n : 300_000n,
          createdById: inspector.id,
        },
      });
    }
    // The units come back on time: notice, the term end, then check-in within the grace.
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

    await returns.inspect(
      contract.id,
      deviceIds[0],
      { result: InspectionResult.DAMAGED, damageCodes: codes, note: null },
      inspector,
      back,
    );

    const charge = await flow.prisma.damageCharge.findFirstOrThrow({
      where: { contractId: contract.id },
    });
    expect(charge).toMatchObject({
      amountVnd: 700_000n,
      status: DamageChargeStatus.PENDING_APPROVAL,
      inspectorId: inspector.id,
    });
    expect(
      await flow.prisma.invoiceLine.count({
        where: { invoice: { contractId: contract.id }, type: InvoiceLineType.DAMAGE },
      }),
    ).toBe(0);

    // billing 1.3 (review of #154): with every invoice paid, the pending charge alone refuses the
    // organization's reactivation through the real ORGANIZATION_EXIT_CHECKS of AppModule.
    await flow.payAll(contract.id, back);
    const organizations = flow.get(OrganizationStatusService);
    const orgVersion = async () =>
      (await flow.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).version;
    await organizations.suspend(org.id, 'Damage under review', await orgVersion(), inspector, back);
    expect(
      await flow.codeOf(organizations.reactivate(org.id, await orgVersion(), inspector, back)),
    ).toBe(ErrorCode.BALANCE_OUTSTANDING);

    expect(
      await flow.codeOf(
        damage.decide(charge.id, { decision: 'APPROVED', note: 'Own inspection' }, inspector, back),
      ),
    ).toBe(ErrorCode.SEPARATION_OF_DUTY);

    await damage.decide(
      charge.id,
      { decision: 'APPROVED', note: 'Photos match' },
      await flow.admin(),
      back,
    );
    const line = await flow.prisma.invoiceLine.findFirstOrThrow({
      where: { invoice: { contractId: contract.id }, type: InvoiceLineType.DAMAGE },
    });
    expect(line.amountVnd).toBe(700_000n);

    // Decided and paid, nothing is outstanding and the organization comes back.
    await flow.payAll(contract.id, back);
    await organizations.reactivate(org.id, await orgVersion(), inspector, back);
    expect(
      (await flow.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).status,
    ).toBe('ACTIVE');
  });

  it('AC-05: a loss on a 14-month-old unit is charged 1,800,000 VND from the remaining-value schedule', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant([
      { fromMonths: 0, valueVnd: 3_000_000 },
      { fromMonths: 12, valueVnd: 1_800_000 },
      { fromMonths: 24, valueVnd: 900_000 },
    ]);
    const deviceIds = await flow.availableDevices(variantId, 5, at('2025-09-15T00:00:00.000Z'));
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
    await flow.approve(contract.id);
    await flow.payAll(contract.id);
    await flow.handOver(contract.id, org.manager.id, deviceIds);
    const row = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: contract.id, deviceId: deviceIds[0] },
    });
    const device = await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceIds[0] } });
    const confirmedAt = at('2026-11-20T03:00:00.000Z');

    await flow.prisma.$transaction((tx) =>
      flow.get(BillingLossCaseListener).onConfirmed(
        {
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
        },
        tx,
      ),
    );

    const loss = await flow.prisma.invoiceLine.findFirstOrThrow({
      where: { invoice: { contractId: contract.id }, type: InvoiceLineType.LOSS },
      select: { amountVnd: true, deviceId: true, invoice: { select: { kind: true } } },
    });
    expect(loss).toEqual({
      amountVnd: 1_800_000n,
      deviceId: device.id,
      invoice: { kind: InvoiceKind.CLOSING },
    });
  });
});
