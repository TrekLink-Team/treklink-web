import { InvoiceLineType, Prisma } from '@prisma/client';
import { DevicesService } from '../devices';
import { BalanceService } from './balance.service';
import { DamageChargesRepository } from './damage-charges.repository';
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
  let damageCharges: Record<string, jest.Mock>;
  let service: BalanceService;

  beforeEach(() => {
    invoices = {
      firstChargeableInvoice: jest.fn().mockResolvedValue(null),
      linesOfContract: jest.fn().mockResolvedValue([]),
      linesOfOrganization: jest.fn().mockResolvedValue([]),
      contractIdsOfOrganization: jest.fn().mockResolvedValue([]),
      linesDueBetween: jest.fn().mockResolvedValue([]),
    };
    damageCharges = {
      pendingOfContract: jest.fn().mockResolvedValue([]),
      countPendingOfContracts: jest.fn().mockResolvedValue(0),
    };
    service = new BalanceService(
      invoices as unknown as InvoicesRepository,
      damageCharges as unknown as DamageChargesRepository,
    );
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

  describe('dueUnpaidOfOrganization (organizations exit check, reactivation)', () => {
    const lineOf = (contractId: string, ...args: Parameters<typeof line>) => ({
      ...line(...args),
      invoice: { contractId },
    });

    it('is zero for an organization with no invoice', async () => {
      await expect(service.dueUnpaidOfOrganization('org-1', LATE, TX)).resolves.toBe(0n);
      expect(invoices.linesOfOrganization).toHaveBeenCalledWith('org-1', TX);
    });

    it('sums what every contract of the organization owes that is due by then', async () => {
      invoices.linesOfOrganization.mockResolvedValue([
        lineOf('c-1', InvoiceLineType.TERM_BALANCE, 2_250_000n, 1_000_000n, EARLY),
        lineOf('c-2', InvoiceLineType.LATE_FEE, 150_000n, 0n, NOW),
        lineOf('c-1', InvoiceLineType.LATE_FEE, 50_000n, 0n, LATE),
      ]);
      await expect(service.dueUnpaidOfOrganization('org-1', LATE)).resolves.toBe(1_450_000n);
    });

    it('leaves out a line not yet due, such as the second installment (leader ruling 2026-10-30)', async () => {
      invoices.linesOfOrganization.mockResolvedValue([
        lineOf('c-1', InvoiceLineType.HOLDING_FEE, 1_125_000n, 1_125_000n, EARLY),
        lineOf('c-1', InvoiceLineType.TERM_BALANCE, 1_125_000n, 0n, LATE),
      ]);
      await expect(service.dueUnpaidOfOrganization('org-1', NOW)).resolves.toBe(0n);
      // On its due time the installment counts.
      await expect(service.dueUnpaidOfOrganization('org-1', LATE)).resolves.toBe(1_125_000n);
    });

    it('applies a credit to the oldest due line first, so it can clear what is due now', async () => {
      invoices.linesOfOrganization.mockResolvedValue([
        lineOf('c-1', InvoiceLineType.LATE_FEE, 100_000n, 0n, EARLY),
        lineOf('c-1', InvoiceLineType.TERM_BALANCE, 900_000n, 0n, LATE),
        lineOf('c-1', InvoiceLineType.ADJUSTMENT, -100_000n, 0n, NOW),
      ]);
      await expect(service.dueUnpaidOfOrganization('org-1', NOW)).resolves.toBe(0n);
    });

    it('nets a credit inside its own contract only, never against another contract', async () => {
      invoices.linesOfOrganization.mockResolvedValue([
        lineOf('c-1', InvoiceLineType.ADJUSTMENT, -500_000n, 0n, NOW),
        lineOf('c-1', InvoiceLineType.LATE_FEE, 100_000n, 0n, EARLY),
        lineOf('c-2', InvoiceLineType.LATE_FEE, 300_000n, 0n, EARLY),
      ]);
      // c-1 owes nothing (its credit exceeds its fee); c-2 still owes its own 300 000.
      await expect(service.dueUnpaidOfOrganization('org-1', NOW)).resolves.toBe(300_000n);
    });
  });

  describe('pendingDamageOfOrganization (organizations exit check, reactivation)', () => {
    it('counts the pending damage charges of the contracts the organization was invoiced for', async () => {
      invoices.contractIdsOfOrganization.mockResolvedValue(['c-1', 'c-2']);
      damageCharges.countPendingOfContracts.mockResolvedValue(2);

      await expect(service.pendingDamageOfOrganization('org-1', TX)).resolves.toBe(2);
      expect(invoices.contractIdsOfOrganization).toHaveBeenCalledWith('org-1', TX);
      expect(damageCharges.countPendingOfContracts).toHaveBeenCalledWith(['c-1', 'c-2'], TX);
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
        pendingDamageCharges: [],
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
        pendingDamageCharges: [],
        settled: true,
      });
    });

    it('lists the damage charges still waiting for an Admin apart from the lines (D-081)', async () => {
      const pending = { id: 'dc-1', amountVnd: 700_000n };
      damageCharges.pendingOfContract.mockResolvedValue([pending]);
      invoices.linesOfContract.mockResolvedValue([
        line(InvoiceLineType.DAY_PLAN_FEE, 720_000n, 720_000n, EARLY),
      ]);
      await expect(service.balanceSummary('c-1', NOW, TX)).resolves.toMatchObject({
        dueNowVnd: 0n,
        pendingDamageCharges: [pending],
        settled: true,
      });
      expect(damageCharges.pendingOfContract).toHaveBeenCalledWith('c-1', TX);
    });
  });

  describe('revenue per variant (task 2.4, monitoring api-design 08)', () => {
    const RANGE = {
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    };
    const due = (contractId: string, amountVnd: bigint, paidVnd: bigint) => ({
      amountVnd,
      paidVnd,
      invoice: { contractId },
    });
    let directory: { describe: jest.Mock; variantsOf: jest.Mock };
    let devices: { variants: jest.Mock };
    const withPorts = () =>
      new BalanceService(
        invoices as unknown as InvoicesRepository,
        damageCharges as unknown as DamageChargesRepository,
        devices as unknown as DevicesService,
        directory,
      );

    beforeEach(() => {
      directory = {
        describe: jest.fn(),
        variantsOf: jest.fn().mockResolvedValue(
          new Map([
            ['c-1', 'v-b'],
            ['c-2', 'v-a'],
            ['c-3', 'v-b'],
          ]),
        ),
      };
      devices = {
        variants: jest.fn().mockResolvedValue([
          { id: 'v-a', code: 'tk-basic' },
          { id: 'v-b', code: 'tk-gps' },
        ]),
      };
    });

    it('sums the lines due in the range by the variant of their contract, ordered by code', async () => {
      invoices.linesDueBetween.mockResolvedValue([
        due('c-1', 450_000n, 450_000n),
        due('c-3', 900_000n, 300_000n),
        due('c-2', 225_000n, 0n),
      ]);
      await expect(withPorts().revenue(RANGE)).resolves.toEqual([
        {
          hardwareVariantId: 'v-a',
          variantCode: 'tk-basic',
          invoicedVnd: 225_000n,
          paidVnd: 0n,
          outstandingVnd: 225_000n,
        },
        {
          hardwareVariantId: 'v-b',
          variantCode: 'tk-gps',
          invoicedVnd: 1_350_000n,
          paidVnd: 750_000n,
          outstandingVnd: 600_000n,
        },
      ]);
      expect(invoices.linesDueBetween).toHaveBeenCalledWith(RANGE.from, RANGE.to);
      expect(directory.variantsOf).toHaveBeenCalledWith(['c-1', 'c-3', 'c-2']);
      expect(devices.variants).toHaveBeenCalledWith(false);
    });

    it('lowers what is invoiced by a negative adjustment and never answers a negative outstanding', async () => {
      invoices.linesDueBetween.mockResolvedValue([
        due('c-1', 450_000n, 450_000n),
        due('c-1', -100_000n, 0n),
      ]);
      await expect(withPorts().revenue(RANGE)).resolves.toEqual([
        expect.objectContaining({ invoicedVnd: 350_000n, paidVnd: 450_000n, outstandingVnd: 0n }),
      ]);
    });

    it('puts a contract the directory does not name, or a variant with no code, in a null row last', async () => {
      directory.variantsOf.mockResolvedValue(
        new Map([
          ['c-2', 'v-a'],
          ['c-4', 'v-gone'],
        ]),
      );
      invoices.linesDueBetween.mockResolvedValue([
        due('c-9', 100_000n, 0n),
        due('c-4', 50_000n, 0n),
        due('c-2', 200_000n, 200_000n),
      ]);
      const rows = await withPorts().revenue(RANGE);
      expect(rows.map((row) => [row.hardwareVariantId, row.variantCode])).toEqual([
        ['v-a', 'tk-basic'],
        ['v-gone', null],
        [null, null],
      ]);
    });

    it('orders mixed-case codes by code unit, upper case first, whatever the locale (review of #177)', async () => {
      directory.variantsOf.mockResolvedValue(
        new Map([
          ['c-1', 'v-lower'],
          ['c-2', 'v-upper'],
          ['c-3', 'v-mixed'],
        ]),
      );
      devices.variants.mockResolvedValue([
        { id: 'v-lower', code: 'tk-gps' },
        { id: 'v-upper', code: 'TK-basic' },
        { id: 'v-mixed', code: 'Tk-mid' },
      ]);
      invoices.linesDueBetween.mockResolvedValue([
        due('c-1', 100_000n, 0n),
        due('c-2', 100_000n, 0n),
        due('c-3', 100_000n, 0n),
      ]);
      const rows = await withPorts().revenue(RANGE);
      // A locale-aware compare would answer TK-basic, tk-gps, Tk-mid.
      expect(rows.map((row) => row.variantCode)).toEqual(['TK-basic', 'Tk-mid', 'tk-gps']);
    });

    it('answers no rows for an empty range, and reads no variants then', async () => {
      await expect(withPorts().revenue(RANGE)).resolves.toEqual([]);
      expect(directory.variantsOf).not.toHaveBeenCalled();
    });

    it('answers one null row without the ports, as in a module test', async () => {
      invoices.linesDueBetween.mockResolvedValue([due('c-1', 450_000n, 0n)]);
      await expect(service.revenue(RANGE)).resolves.toEqual([
        {
          hardwareVariantId: null,
          variantCode: null,
          invoicedVnd: 450_000n,
          paidVnd: 0n,
          outstandingVnd: 450_000n,
        },
      ]);
    });
  });
});
