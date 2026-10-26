import { InvoiceLineType, Prisma } from '@prisma/client';
import { BalanceService } from './balance.service';
import { InvoicesRepository } from './invoices.repository';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const EARLY = new Date('2026-10-25T02:00:00.000Z');
const LATE = new Date('2026-11-25T02:00:00.000Z');
const TX = {} as Prisma.TransactionClient;

let seq = 0;
const line = (type: InvoiceLineType, amountVnd: bigint, paidVnd: bigint, dueAt: Date) => {
  seq += 1;
  return { id: `l-${seq}`, invoiceId: 'inv-1', seq, type, amountVnd, paidVnd, dueAt };
};

describe('BalanceService (billing task 2.4, REQ-STA-02, FR-CON-13)', () => {
  let invoices: Record<string, jest.Mock>;
  let service: BalanceService;

  beforeEach(() => {
    invoices = {
      firstChargeableInvoice: jest.fn().mockResolvedValue(null),
      linesOfContract: jest.fn().mockResolvedValue([]),
    };
    service = new BalanceService(invoices as unknown as InvoicesRepository);
  });

  describe('firstPaymentConfirmed (FR-CON-05, BR-09)', () => {
    it('is true once the first line of the first invoice is paid in full', async () => {
      invoices.firstChargeableInvoice.mockResolvedValue({
        lines: [
          line(InvoiceLineType.HOLDING_FEE, 2_250_000n, 2_250_000n, EARLY),
          line(InvoiceLineType.TERM_BALANCE, 2_250_000n, 0n, LATE),
        ],
      });
      await expect(service.firstPaymentConfirmed('c-1', TX)).resolves.toBe(true);
      expect(invoices.firstChargeableInvoice).toHaveBeenCalledWith('c-1', TX);
    });

    it('is false while the holding fee or the day-plan fee is only partly paid', async () => {
      invoices.firstChargeableInvoice.mockResolvedValue({
        lines: [line(InvoiceLineType.DAY_PLAN_FEE, 720_000n, 700_000n, EARLY)],
      });
      await expect(service.firstPaymentConfirmed('c-1')).resolves.toBe(false);
    });

    it('is false with no invoice, or an invoice with no lines', async () => {
      await expect(service.firstPaymentConfirmed('c-1')).resolves.toBe(false);
      invoices.firstChargeableInvoice.mockResolvedValue({ lines: [] });
      await expect(service.firstPaymentConfirmed('c-1')).resolves.toBe(false);
    });
  });

  describe('outstanding', () => {
    it('sums what every line still owes', async () => {
      invoices.linesOfContract.mockResolvedValue([
        line(InvoiceLineType.HOLDING_FEE, 2_250_000n, 2_250_000n, EARLY),
        line(InvoiceLineType.TERM_BALANCE, 2_250_000n, 1_000_000n, LATE),
        line(InvoiceLineType.LATE_FEE, 150_000n, 0n, NOW),
      ]);
      await expect(service.outstanding('c-1', TX)).resolves.toBe(1_400_000n);
      expect(invoices.linesOfContract).toHaveBeenCalledWith('c-1', TX);
    });

    it('nets a cancellation adjustment against the unpaid lines', async () => {
      invoices.linesOfContract.mockResolvedValue([
        line(InvoiceLineType.HOLDING_FEE, 2_250_000n, 2_250_000n, EARLY),
        line(InvoiceLineType.TERM_BALANCE, 2_250_000n, 0n, LATE),
        line(InvoiceLineType.ADJUSTMENT, -2_250_000n, 0n, NOW),
      ]);
      await expect(service.outstanding('c-1')).resolves.toBe(0n);
    });

    it('never goes below zero when credits exceed what is owed', async () => {
      invoices.linesOfContract.mockResolvedValue([
        line(InvoiceLineType.LATE_FEE, 50_000n, 0n, EARLY),
        line(InvoiceLineType.ADJUSTMENT, -80_000n, 0n, NOW),
      ]);
      await expect(service.outstanding('c-1')).resolves.toBe(0n);
    });
  });

  describe('balanceSummary (api-design 10)', () => {
    it('splits what is owed into due now and due later, and sums what is paid', async () => {
      invoices.linesOfContract.mockResolvedValue([
        line(InvoiceLineType.HOLDING_FEE, 2_250_000n, 2_250_000n, EARLY),
        line(InvoiceLineType.TERM_BALANCE, 2_250_000n, 0n, LATE),
        line(InvoiceLineType.LATE_FEE, 100_000n, 0n, NOW),
      ]);

      await expect(service.balanceSummary('c-1', NOW, TX)).resolves.toEqual({
        contractId: 'c-1',
        dueNowVnd: 100_000n,
        dueLaterVnd: 2_250_000n,
        paidVnd: 2_250_000n,
        settled: false,
      });
    });

    it('credits an adjustment against the oldest-due line first', async () => {
      invoices.linesOfContract.mockResolvedValue([
        line(InvoiceLineType.TERM_BALANCE, 2_250_000n, 0n, LATE),
        line(InvoiceLineType.HOLDING_FEE, 2_250_000n, 0n, EARLY),
        line(InvoiceLineType.ADJUSTMENT, -3_000_000n, 0n, NOW),
      ]);

      await expect(service.balanceSummary('c-1', NOW)).resolves.toMatchObject({
        dueNowVnd: 0n,
        dueLaterVnd: 1_500_000n,
        settled: false,
      });
    });

    it('is settled when nothing is owed, and reads at the current time by default', async () => {
      invoices.linesOfContract.mockResolvedValue([
        line(InvoiceLineType.DAY_PLAN_FEE, 720_000n, 720_000n, EARLY),
      ]);
      await expect(service.balanceSummary('c-1')).resolves.toEqual({
        contractId: 'c-1',
        dueNowVnd: 0n,
        dueLaterVnd: 0n,
        paidVnd: 720_000n,
        settled: true,
      });
    });
  });
});
