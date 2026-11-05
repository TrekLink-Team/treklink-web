import { InvoiceKind, InvoiceLineType, PlanType, Prisma } from '@prisma/client';
import { ChargesService, EndedContract } from './charges.service';
import { InvoicesRepository } from './invoices.repository';

// The early-end credit (billing task 9.1, REQ-EVT-16, design §10, AC-09, D-097 rule 2).
const TX = {} as Prisma.TransactionClient;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = new Date('2026-11-01T02:00:00.000Z');
const TERM_30 = { seq: 2, startsAt: START, endsAt: new Date(START.getTime() + 30 * DAY) };
const TERM_31 = { seq: 3, startsAt: START, endsAt: new Date(START.getTime() + 31 * DAY) };
const MONTHLY: EndedContract = {
  id: 'c-1',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  quantity: 2,
  monthlyUnitPriceVnd: 450_000n,
};
const DAY_6 = new Date(START.getTime() + 5 * DAY + HOUR);

describe('ChargesService early-end credit (billing task 9.1)', () => {
  let invoices: Record<string, jest.Mock>;
  let ledger: { land: jest.Mock };
  let service: ChargesService;

  beforeEach(() => {
    invoices = {
      lockClosingInvoice: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({ id: 'closing-1' }),
      appendLines: jest.fn().mockResolvedValue({ id: 'closing-0' }),
    };
    ledger = { land: jest.fn().mockImplementation((_id, invoice: unknown) => invoice) };
    service = new ChargesService(
      invoices as unknown as InvoicesRepository,
      {} as never,
      {} as never,
      {} as never,
      ledger as never,
    );
  });

  describe('earlyEndCredit (the computation, nothing stored)', () => {
    it('credits 24 of 30 days of a 900,000 VND term ended on day 6', () => {
      expect(service.earlyEndCredit(MONTHLY, TERM_30, DAY_6)).toEqual({
        termFeeVnd: 900_000n,
        termDays: 30,
        usedDays: 6,
        unusedDays: 24,
        creditVnd: 720_000n,
      });
      expect(invoices.insert).not.toHaveBeenCalled();
    });

    it('credits 29 days on the first day and nothing on the last day', () => {
      expect(
        service.earlyEndCredit(MONTHLY, TERM_30, new Date(START.getTime() + HOUR)).creditVnd,
      ).toBe(870_000n);
      expect(
        service.earlyEndCredit(MONTHLY, TERM_30, new Date(TERM_30.endsAt.getTime() - HOUR))
          .creditVnd,
      ).toBe(0n);
    });

    it('divides by 31 on a 31-day term', () => {
      expect(service.earlyEndCredit(MONTHLY, TERM_31, DAY_6)).toMatchObject({
        termDays: 31,
        unusedDays: 25,
        creditVnd: 725_807n,
      });
    });

    it('gives a day plan no credit', () => {
      const dayPlan = { ...MONTHLY, planType: PlanType.DAY };
      const term = { seq: 1, startsAt: START, endsAt: new Date(START.getTime() + 4 * DAY) };
      expect(service.earlyEndCredit(dayPlan, term, new Date(START.getTime() + HOUR))).toMatchObject(
        {
          unusedDays: 0,
          creditVnd: 0n,
        },
      );
    });
  });

  describe('creditEarlyEnd (the closing invoice line)', () => {
    it('adds one negative EARLY_END_CREDIT line with its author, reason and due time', async () => {
      const { quote, invoice } = await service.creditEarlyEnd(
        MONTHLY,
        TERM_30,
        DAY_6,
        'Trek finished early',
        'u-staff',
        TX,
      );

      expect(quote.creditVnd).toBe(720_000n);
      expect(invoice).toEqual({ id: 'closing-1' });
      expect(invoices.insert).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          contractId: 'c-1',
          termId: null,
          kind: InvoiceKind.CLOSING,
          issuedAt: DAY_6,
        },
        [
          {
            type: InvoiceLineType.EARLY_END_CREDIT,
            description:
              'Early end of term 2: 24 unused days of 30 credited. Reason: Trek finished early',
            quantity: 1,
            unitVnd: -720_000n,
            amountVnd: -720_000n,
            dueAt: DAY_6,
            createdById: 'u-staff',
          },
        ],
        TX,
      );
      expect(ledger.land).toHaveBeenCalledWith('c-1', { id: 'closing-1' }, TX, DAY_6);
    });

    it('appends to an existing closing invoice', async () => {
      invoices.lockClosingInvoice.mockResolvedValue({ id: 'closing-0' });

      await service.creditEarlyEnd(MONTHLY, TERM_30, DAY_6, 'Early', 'u-mgr', TX);

      expect(invoices.appendLines).toHaveBeenCalledTimes(1);
      expect(invoices.insert).not.toHaveBeenCalled();
    });

    it('writes nothing for a day plan or on the last day', async () => {
      const lastDay = new Date(TERM_30.endsAt.getTime() - HOUR);
      await expect(
        service.creditEarlyEnd(MONTHLY, TERM_30, lastDay, 'Done', 'u-staff', TX),
      ).resolves.toMatchObject({ invoice: null, quote: { creditVnd: 0n } });
      await expect(
        service.creditEarlyEnd(
          { ...MONTHLY, planType: PlanType.DAY },
          TERM_30,
          DAY_6,
          'Done',
          null,
          TX,
        ),
      ).resolves.toMatchObject({ invoice: null });
      expect(invoices.insert).not.toHaveBeenCalled();
      expect(invoices.appendLines).not.toHaveBeenCalled();
    });
  });
});
