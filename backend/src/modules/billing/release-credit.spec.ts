import {
  InvoiceLineType,
  PlanType,
  Prisma,
  ServiceCreditCause,
  ServiceCreditKind,
  ServiceCreditStatus,
} from '@prisma/client';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ChargesService, FirstInvoiceContract } from './charges.service';
import { InvoiceRow, InvoicesRepository, NewInvoiceLine } from './invoices.repository';
import { holdingFeeVnd } from './money';
import { ServiceCreditLedger } from './service-credit-ledger';
import { releaseCreditQuote } from './service-credit.service';
import { ServiceCreditRow, ServiceCreditsRepository } from './service-credits.repository';

const TX = {} as Prisma.TransactionClient;
const TERM = {
  startsAt: new Date('2026-11-01T02:00:00.000Z'),
  endsAt: new Date('2026-12-01T02:00:00.000Z'),
};
const day = (n: number) => new Date(TERM.startsAt.getTime() + n * 86_400_000);

// Billing design §12 (D-099 rules 1 and 4): the release credit and the lowered first invoice.
describe('releaseCreditQuote (design §12.1)', () => {
  it('AC-13: credits one unit the unused whole days of the term at the D-097 rate', () => {
    // 450,000 x 20 / 30
    expect(
      releaseCreditQuote({ planType: 'MONTHLY', monthlyUnitPriceVnd: 450_000n }, TERM, day(10)),
    ).toEqual({
      termDays: 30,
      usedDays: 10,
      unusedDays: 20,
      creditVnd: 300_000n,
    });
  });

  it('gives none for a day plan or without an open term, and zero on the last day', () => {
    expect(
      releaseCreditQuote({ planType: 'DAY', monthlyUnitPriceVnd: 450_000n }, TERM, day(10)),
    ).toBeNull();
    expect(
      releaseCreditQuote({ planType: 'MONTHLY', monthlyUnitPriceVnd: 450_000n }, null, day(10)),
    ).toBeNull();
    expect(
      releaseCreditQuote({ planType: 'MONTHLY', monthlyUnitPriceVnd: 450_000n }, TERM, day(29.5))
        ?.creditVnd,
    ).toBe(0n);
  });
});

describe('ChargesService.lowerFirstInvoice (design §12.2)', () => {
  const contract = (overrides: Partial<FirstInvoiceContract> = {}): FirstInvoiceContract => ({
    id: 'c-1',
    organizationId: 'org-1',
    planType: PlanType.MONTHLY,
    quantity: 5,
    monthlyUnitPriceVnd: 450_000n,
    holdingFeeRatio: new Prisma.Decimal('0.5'),
    dayPremium: null,
    dayPlanDays: null,
    ...overrides,
  });

  const build = (lines: { type: InvoiceLineType; amountVnd: bigint }[], paidVnd = 0n) => {
    const total = lines.reduce((sum, line) => sum + line.amountVnd, 0n);
    const first = {
      id: 'inv-1',
      totalVnd: total,
      paidVnd,
      lines: lines.map((line, i) => ({
        id: `l-${i}`,
        seq: i + 1,
        paidVnd: 0n,
        dueAt: TERM.startsAt,
        ...line,
      })),
    };
    const invoices = {
      firstChargeableInvoice: jest.fn().mockResolvedValue(first),
      lockWithLines: jest.fn().mockResolvedValue(first),
      appendLines: jest.fn((invoice: InvoiceRow, added: NewInvoiceLine[]) =>
        Promise.resolve({
          ...invoice,
          totalVnd: added.reduce((sum, line) => sum + line.amountVnd, invoice.totalVnd),
        }),
      ),
    };
    const charges = new ChargesService(
      invoices as unknown as InvoicesRepository,
      {} as never,
      {} as never,
      {} as never,
    );
    return { charges, invoices };
  };

  it('AC-14: lowers both monthly lines by one unit, so the total is that of four units', async () => {
    const { charges, invoices } = build(
      [
        { type: InvoiceLineType.HOLDING_FEE, amountVnd: 1_125_000n },
        { type: InvoiceLineType.TERM_BALANCE, amountVnd: 1_125_000n },
      ],
      1_125_000n,
    );
    const lowered = await charges.lowerFirstInvoice(contract(), 'u-staff', TX);
    expect(invoices.appendLines).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1' }),
      [
        expect.objectContaining({
          type: InvoiceLineType.ADJUSTMENT,
          amountVnd: -225_000n,
          createdById: 'u-staff',
        }),
        expect.objectContaining({ type: InvoiceLineType.ADJUSTMENT, amountVnd: -225_000n }),
      ],
      TX,
    );
    expect(lowered?.invoice.totalVnd).toBe(1_800_000n);
    expect(lowered?.loweredByVnd).toBe(450_000n);
  });

  it('recomputes a rounded holding fee instead of taking one unit of it', async () => {
    // 3 units at 100,001 VND with ratio 0.333: the fee rounds up, so it does not divide by 3.
    const ratio = new Prisma.Decimal('0.333');
    const holding3 = holdingFeeVnd(100_001n, 3, ratio);
    const holding2 = holdingFeeVnd(100_001n, 2, ratio);
    const { charges, invoices } = build([
      { type: InvoiceLineType.HOLDING_FEE, amountVnd: holding3 },
      { type: InvoiceLineType.TERM_BALANCE, amountVnd: 300_003n - holding3 },
    ]);
    await charges.lowerFirstInvoice(
      contract({ quantity: 3, monthlyUnitPriceVnd: 100_001n, holdingFeeRatio: ratio }),
      'u-staff',
      TX,
    );
    const added = invoices.appendLines.mock.calls[0][1];
    expect(added[0].amountVnd).toBe(holding2 - holding3);
    expect(added.reduce((sum, line) => sum + line.amountVnd, 0n)).toBe(200_002n - 300_003n);
  });

  it('lowers a day-plan fee, and does nothing without an issued invoice', async () => {
    const { charges, invoices } = build([
      { type: InvoiceLineType.DAY_PLAN_FEE, amountVnd: 720_000n },
    ]);
    const lowered = await charges.lowerFirstInvoice(
      contract({
        planType: PlanType.DAY,
        quantity: 8,
        dayPremium: new Prisma.Decimal('1.5'),
        dayPlanDays: 4,
      }),
      'u-staff',
      TX,
    );
    // 8 to 7 units at 450,000 x 1.5 x 4 / 30
    expect(lowered?.loweredByVnd).toBe(90_000n);
    expect(invoices.appendLines).toHaveBeenCalledTimes(1);
    invoices.firstChargeableInvoice.mockResolvedValueOnce(null);
    await expect(charges.lowerFirstInvoice(contract(), 'u-staff', TX)).resolves.toBeNull();
  });
});

describe('ServiceCreditLedger with a RELEASE credit (design §12.1)', () => {
  it('lands it as an EARLY_END_CREDIT line named Release credit', async () => {
    const credit = {
      id: 'sc-7',
      contractId: 'c-1',
      organizationId: 'org-1',
      deviceId: 'dev-1',
      kind: ServiceCreditKind.RELEASE,
      cause: null,
      decidedVnd: 300_000n,
      appliedVnd: 0n,
      status: ServiceCreditStatus.APPROVED,
      decidedById: 'admin-1',
    } as unknown as ServiceCreditRow;
    const invoices = {
      appendLines: jest.fn((invoice: InvoiceRow, lines: NewInvoiceLine[]) =>
        Promise.resolve({ ...invoice, totalVnd: invoice.totalVnd + lines[0].amountVnd }),
      ),
    };
    const ledger = new ServiceCreditLedger(
      {
        approvedWithRemainder: jest.fn().mockResolvedValue([credit]),
        update: jest.fn((id: string, data: object) => Promise.resolve({ ...credit, ...data })),
      } as unknown as ServiceCreditsRepository,
      invoices as unknown as InvoicesRepository,
      {
        assetTags: jest.fn().mockResolvedValue(new Map([['dev-1', 'TL-0042']])),
      } as unknown as DevicesService,
      { emitAfterCommit: jest.fn() } as unknown as TransactionalEvents,
    );
    await ledger.land(
      'c-1',
      { id: 'inv-2', totalVnd: 1_800_000n, paidVnd: 0n } as InvoiceRow,
      TX,
      TERM.endsAt,
    );
    expect(invoices.appendLines).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({
          type: InvoiceLineType.EARLY_END_CREDIT,
          description: 'Release credit for TL-0042',
          amountVnd: -300_000n,
          serviceCreditId: 'sc-7',
        }),
      ],
      TX,
    );
    // a FAULT credit keeps its own line type
    expect(ServiceCreditCause.BATTERY_FAULT).toBe('BATTERY_FAULT');
  });
});
