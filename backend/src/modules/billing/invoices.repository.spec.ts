import { InvoiceKind, InvoiceLineType, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  INVOICE_SELECT,
  invoiceNumberYear,
  invoiceStatusOf,
  InvoicesRepository,
  LINE_SELECT,
  NewInvoiceLine,
} from './invoices.repository';

const AT = new Date('2026-10-25T02:00:00.000Z');

const LINE: NewInvoiceLine = {
  type: InvoiceLineType.HOLDING_FEE,
  description: 'Term 1 holding fee, 10 x treklink-v3',
  quantity: 10,
  unitVnd: 225_000n,
  amountVnd: 2_250_000n,
  dueAt: AT,
  createdById: null,
};

const ROW = {
  id: 'inv-1',
  number: 'INV-2026-000001',
  organizationId: 'org-1',
  contractId: 'c-1',
  termId: null,
  kind: InvoiceKind.CLOSING,
  status: InvoiceStatus.ISSUED,
  totalVnd: 100_000n,
  paidVnd: 40_000n,
  issuedAt: AT,
};

describe('invoiceNumberYear and invoiceStatusOf', () => {
  it('counts invoice numbers by the calendar year in UTC+7', () => {
    expect(invoiceNumberYear(new Date('2026-12-31T16:59:59.000Z'))).toBe(2026);
    expect(invoiceNumberYear(new Date('2026-12-31T17:00:00.000Z'))).toBe(2027);
  });

  it('derives the status from the total and what is paid', () => {
    expect(invoiceStatusOf(100n, 0n)).toBe(InvoiceStatus.ISSUED);
    expect(invoiceStatusOf(100n, 40n)).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(invoiceStatusOf(100n, 100n)).toBe(InvoiceStatus.PAID);
    expect(invoiceStatusOf(-50n, 0n)).toBe(InvoiceStatus.PAID);
  });
});

describe('InvoicesRepository (billing task 1.1)', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    invoice: Record<string, jest.Mock>;
    invoiceLine: Record<string, jest.Mock>;
  };
  let repository: InvoicesRepository;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(ROW),
        update: jest.fn().mockResolvedValue(ROW),
      },
      invoiceLine: {
        aggregate: jest.fn().mockResolvedValue({ _max: { seq: 2 } }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    repository = new InvoicesRepository(tx as unknown as PrismaService);
  });

  const client = () => tx as unknown as Prisma.TransactionClient;
  const lockKey = (call: number) => {
    const [sql, key] = tx.$executeRaw.mock.calls[call] as [TemplateStringsArray, string];
    return { sql: sql.join('?'), key };
  };

  describe('insert', () => {
    const invoice = {
      organizationId: 'org-1',
      contractId: 'c-1',
      termId: 't-1',
      kind: InvoiceKind.TERM,
      issuedAt: AT,
    };

    it('numbers the invoice INV-<year>-000001 under the year lock and its lines from seq 1', async () => {
      const second = { ...LINE, type: InvoiceLineType.TERM_BALANCE };
      await expect(repository.insert(invoice, [LINE, second], client())).resolves.toBe(ROW);

      expect(lockKey(0)).toEqual({
        sql: 'SELECT pg_advisory_xact_lock(hashtext(?))',
        key: 'billing:invoice:2026',
      });
      expect(tx.invoice.findFirst).toHaveBeenCalledWith({
        where: { number: { startsWith: 'INV-2026-' } },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      expect(tx.invoice.create).toHaveBeenCalledWith({
        data: {
          ...invoice,
          number: 'INV-2026-000001',
          totalVnd: 4_500_000n,
          status: InvoiceStatus.ISSUED,
          lines: {
            create: [
              { ...LINE, seq: 1 },
              { ...second, seq: 2 },
            ],
          },
        },
        select: INVOICE_SELECT,
      });
    });

    it('continues the year sequence, and refuses past 999999', async () => {
      tx.invoice.findFirst.mockResolvedValueOnce({ number: 'INV-2026-000122' });
      await repository.insert(invoice, [LINE], client());
      expect(tx.invoice.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ number: 'INV-2026-000123' }) as object,
        }),
      );

      tx.invoice.findFirst.mockResolvedValueOnce({ number: 'INV-2026-999999' });
      await expect(repository.insert(invoice, [LINE], client())).rejects.toThrow(
        'Invoice number range exhausted for 2026.',
      );
    });
  });

  it('serializes closing-invoice work per contract before reading the closing invoice', async () => {
    tx.invoice.findFirst.mockResolvedValueOnce(ROW);
    await expect(repository.lockClosingInvoice('c-1', client())).resolves.toBe(ROW);

    expect(lockKey(0)).toEqual({
      sql: 'SELECT pg_advisory_xact_lock(hashtext(?))',
      key: 'billing:closing:c-1',
    });
    expect(tx.invoice.findFirst).toHaveBeenCalledWith({
      where: { contractId: 'c-1', kind: InvoiceKind.CLOSING },
      select: INVOICE_SELECT,
    });
  });

  describe('appendLines', () => {
    const adjustment = {
      ...LINE,
      type: InvoiceLineType.ADJUSTMENT,
      quantity: 1,
      unitVnd: -30_000n,
      amountVnd: -30_000n,
    };

    it('numbers new lines after the last seq and moves the total and the status', async () => {
      await expect(repository.appendLines(ROW, [adjustment], client())).resolves.toBe(ROW);

      expect(tx.invoiceLine.aggregate).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-1' },
        _max: { seq: true },
      });
      expect(tx.invoiceLine.createMany).toHaveBeenCalledWith({
        data: [{ ...adjustment, invoiceId: 'inv-1', seq: 3 }],
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { totalVnd: 70_000n, status: InvoiceStatus.PARTIALLY_PAID },
        select: INVOICE_SELECT,
      });
    });

    it('starts at seq 1 on an invoice with no lines', async () => {
      tx.invoiceLine.aggregate.mockResolvedValueOnce({ _max: { seq: null } });
      await repository.appendLines({ ...ROW, totalVnd: 0n, paidVnd: 0n }, [adjustment], client());

      expect(tx.invoiceLine.createMany).toHaveBeenCalledWith({
        data: [{ ...adjustment, invoiceId: 'inv-1', seq: 1 }],
      });
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totalVnd: -30_000n, status: InvoiceStatus.PAID } }),
      );
    });
  });

  describe('lockWithLines and applyPayment (billing task 3.1)', () => {
    const line = (id: string, amountVnd: bigint, paidVnd: bigint) => ({
      id,
      invoiceId: 'inv-1',
      seq: Number(id.slice(2)),
      type: InvoiceLineType.TERM_BALANCE,
      amountVnd,
      paidVnd,
      dueAt: AT,
    });

    it('locks the invoice FOR UPDATE, then reads it with its lines oldest due first', async () => {
      await repository.lockWithLines('inv-1', client());

      const [sql, id] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
      expect(sql.join('?')).toBe('SELECT 1 FROM "invoices" WHERE "id" = ? FOR UPDATE');
      expect(id).toBe('inv-1');
      expect(tx.invoice.findUnique).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        select: {
          ...INVOICE_SELECT,
          lines: { select: LINE_SELECT, orderBy: [{ dueAt: 'asc' }, { seq: 'asc' }] },
        },
      });
    });

    it('fills unpaid lines in order, skips paid and negative lines, and stops when spent', async () => {
      const invoice = {
        ...ROW,
        totalVnd: 300_000n,
        paidVnd: 0n,
        lines: [
          line('l-1', 100_000n, 100_000n),
          line('l-2', -20_000n, 0n),
          line('l-3', 100_000n, 40_000n),
          line('l-4', 100_000n, 0n),
          line('l-5', 100_000n, 0n),
        ],
      };

      await repository.applyPayment(invoice, 110_000n, client());

      expect(tx.invoiceLine.update.mock.calls).toEqual([
        [{ where: { id: 'l-3' }, data: { paidVnd: 100_000n } }],
        [{ where: { id: 'l-4' }, data: { paidVnd: 50_000n } }],
      ]);
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { paidVnd: 110_000n, status: InvoiceStatus.PARTIALLY_PAID },
        select: INVOICE_SELECT,
      });
    });
  });

  it('lists each contract an organization was invoiced for once', async () => {
    tx.invoice.findMany.mockResolvedValueOnce([{ contractId: 'c-1' }, { contractId: 'c-2' }]);
    await expect(repository.contractIdsOfOrganization('org-1', client())).resolves.toEqual([
      'c-1',
      'c-2',
    ]);
    expect(tx.invoice.findMany).toHaveBeenLastCalledWith({
      where: { organizationId: 'org-1' },
      distinct: ['contractId'],
      select: { contractId: true },
    });
  });

  it('reads every line of every invoice of an organization with its contract, oldest due first', async () => {
    await repository.linesOfOrganization('org-1', client());
    await repository.linesOfOrganization('org-2');
    expect(tx.invoiceLine.findMany).toHaveBeenCalledWith({
      where: { invoice: { organizationId: 'org-1' } },
      orderBy: [{ dueAt: 'asc' }, { seq: 'asc' }],
      select: { ...LINE_SELECT, invoice: { select: { contractId: true } } },
    });
    expect(tx.invoiceLine.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { invoice: { organizationId: 'org-2' } } }),
    );
  });

  it('reads the first TERM or DAY_PLAN invoice of a contract with its lines in order', async () => {
    await repository.firstChargeableInvoice('c-1');
    expect(tx.invoice.findFirst).toHaveBeenCalledWith({
      where: { contractId: 'c-1', kind: { in: [InvoiceKind.TERM, InvoiceKind.DAY_PLAN] } },
      orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
      select: { ...INVOICE_SELECT, lines: { select: LINE_SELECT, orderBy: { seq: 'asc' } } },
    });
  });

  it('reads every line of a contract, oldest due first, in the caller transaction', async () => {
    await repository.linesOfContract('c-1', client());
    await repository.linesOfContract('c-2');
    expect(tx.invoiceLine.findMany).toHaveBeenCalledWith({
      where: { invoice: { contractId: 'c-1' } },
      orderBy: [{ dueAt: 'asc' }, { seq: 'asc' }],
      select: LINE_SELECT,
    });
    expect(tx.invoiceLine.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { invoice: { contractId: 'c-2' } } }),
    );
  });
});
