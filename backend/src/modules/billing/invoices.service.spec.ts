import { InvoiceKind, InvoiceLineType, Prisma } from '@prisma/client';
import { InvoicesRepository } from './invoices.repository';
import { BillableDayPlan, BillableMonthlyContract, InvoicesService } from './invoices.service';

const AT = new Date('2026-10-20T03:15:00.000Z');
const TX = {} as Prisma.TransactionClient;

const MONTHLY: BillableMonthlyContract = {
  id: 'c-1',
  organizationId: 'org-1',
  quantity: 10,
  monthlyUnitPriceVnd: 450_000n,
  holdingFeeRatio: new Prisma.Decimal('0.5'),
  variantCode: 'treklink-v3',
};

const TERM = {
  id: 't-1',
  seq: 1,
  startsAt: new Date('2026-10-25T02:00:00.000Z'),
  endsAt: new Date('2026-11-25T02:00:00.000Z'),
};

const DAY: BillableDayPlan = {
  id: 'c-2',
  organizationId: 'org-1',
  quantity: 8,
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: new Prisma.Decimal('1.5'),
  dayPlanDays: 4,
  variantCode: 'treklink-v3',
  termId: 't-9',
  startsAt: new Date('2026-11-01T02:00:00.000Z'),
};

describe('InvoicesService (billing task 2.2)', () => {
  let invoices: { insert: jest.Mock };
  let service: InvoicesService;

  beforeEach(() => {
    invoices = { insert: jest.fn().mockResolvedValue({ id: 'inv-1' }) };
    service = new InvoicesService(invoices as unknown as InvoicesRepository);
  });

  it('AC-01: one TERM invoice, the holding fee due at the term start and the balance at its end', async () => {
    await expect(service.issueTermInvoice(MONTHLY, TERM, TX, AT)).resolves.toEqual({ id: 'inv-1' });

    expect(invoices.insert).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        contractId: 'c-1',
        termId: 't-1',
        kind: InvoiceKind.TERM,
        issuedAt: AT,
      },
      [
        {
          type: InvoiceLineType.HOLDING_FEE,
          description: 'Term 1 holding fee, 10 x treklink-v3',
          quantity: 10,
          unitVnd: 225_000n,
          amountVnd: 2_250_000n,
          dueAt: TERM.startsAt,
          createdById: null,
        },
        {
          type: InvoiceLineType.TERM_BALANCE,
          description: 'Term 1 balance, 10 x treklink-v3',
          quantity: 10,
          unitVnd: 225_000n,
          amountVnd: 2_250_000n,
          dueAt: TERM.endsAt,
          createdById: null,
        },
      ],
      TX,
    );
  });

  it('rounds the holding fee up and gives the remainder to the balance line', async () => {
    await service.issueTermInvoice(
      { ...MONTHLY, quantity: 1, monthlyUnitPriceVnd: 450_001n },
      { ...TERM, seq: 2 },
      TX,
      AT,
    );

    const [, lines] = invoices.insert.mock.calls[0] as [unknown, { amountVnd: bigint }[]];
    expect(lines.map((line) => line.amountVnd)).toEqual([225_001n, 225_000n]);
  });

  it('keeps one line of the whole amount when it does not divide by the device count', async () => {
    await service.issueTermInvoice(
      { ...MONTHLY, quantity: 3, monthlyUnitPriceVnd: 100_001n },
      TERM,
      TX,
      AT,
    );

    const [, lines] = invoices.insert.mock.calls[0] as [
      unknown,
      { quantity: number; unitVnd: bigint; amountVnd: bigint }[],
    ];
    // 300,003 × 0.5 = 150,001.5, rounded up to 150,002: not divisible by 3.
    expect(lines[0]).toMatchObject({ quantity: 1, unitVnd: 150_002n, amountVnd: 150_002n });
    expect(lines[1]).toMatchObject({ quantity: 1, unitVnd: 150_001n, amountVnd: 150_001n });
  });

  it('AC-02: one DAY_PLAN invoice of 720,000 VND due at the start date, linked to the term', async () => {
    await service.issueDayPlanInvoice(DAY, TX, AT);

    expect(invoices.insert).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        contractId: 'c-2',
        termId: 't-9',
        kind: InvoiceKind.DAY_PLAN,
        issuedAt: AT,
      },
      [
        {
          type: InvoiceLineType.DAY_PLAN_FEE,
          description: 'Day plan, 4 days, 8 x treklink-v3',
          quantity: 8,
          unitVnd: 90_000n,
          amountVnd: 720_000n,
          dueAt: DAY.startsAt,
          createdById: null,
        },
      ],
      TX,
    );
  });

  it('issues at the current time by default', async () => {
    const before = Date.now();
    await service.issueTermInvoice(MONTHLY, TERM, TX);
    await service.issueDayPlanInvoice(DAY, TX);

    for (const [invoice] of invoices.insert.mock.calls as [{ issuedAt: Date }][]) {
      expect(invoice.issuedAt.getTime()).toBeGreaterThanOrEqual(before);
    }
  });
});
