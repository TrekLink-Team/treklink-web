import { InvoiceKind, InvoiceLineType, InvoiceStatus, Prisma } from '@prisma/client';
import { ChargesService } from './charges.service';
import { InvoicesRepository } from './invoices.repository';

const AT = new Date('2026-10-26T04:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const CONTRACT = { id: 'c-1', organizationId: 'org-1' };

const line = (seq: number, type: InvoiceLineType, amountVnd: bigint, paidVnd: bigint) => ({
  id: `l-${seq}`,
  invoiceId: 'inv-1',
  seq,
  type,
  amountVnd,
  paidVnd,
  dueAt: AT,
});

const FIRST = {
  id: 'inv-1',
  number: 'INV-2026-000001',
  organizationId: 'org-1',
  contractId: 'c-1',
  termId: 't-1',
  kind: InvoiceKind.TERM,
  status: InvoiceStatus.ISSUED,
  totalVnd: 4_500_000n,
  paidVnd: 0n,
  issuedAt: AT,
  lines: [
    line(1, InvoiceLineType.HOLDING_FEE, 2_250_000n, 0n),
    line(2, InvoiceLineType.TERM_BALANCE, 2_250_000n, 0n),
  ],
};

const adjustment = (amountVnd: bigint, createdById: string | null) => ({
  type: InvoiceLineType.ADJUSTMENT,
  description: 'Cancellation before handover: voids the unpaid lines of INV-2026-000001',
  quantity: 1,
  unitVnd: amountVnd,
  amountVnd,
  dueAt: AT,
  createdById,
});

describe('ChargesService.settleCancellation (billing task 2.3, REQ-EVT-11, E01-7)', () => {
  let invoices: Record<string, jest.Mock>;
  let service: ChargesService;

  beforeEach(() => {
    invoices = {
      firstChargeableInvoice: jest.fn().mockResolvedValue(FIRST),
      lockClosingInvoice: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({ id: 'closing-1' }),
      appendLines: jest.fn().mockResolvedValue({ id: 'closing-0' }),
    };
    // Late and damage charges are covered in charges.service.late-damage.spec.ts.
    service = new ChargesService(
      invoices as unknown as InvoicesRepository,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('cancelled before the holding fee is paid: voids both lines on a new closing invoice', async () => {
    await expect(service.settleCancellation(CONTRACT, 'manager-1', TX, AT)).resolves.toEqual({
      id: 'closing-1',
    });

    expect(invoices.firstChargeableInvoice).toHaveBeenCalledWith('c-1', TX);
    expect(invoices.lockClosingInvoice).toHaveBeenCalledWith('c-1', TX);
    expect(invoices.insert).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        contractId: 'c-1',
        termId: null,
        kind: InvoiceKind.CLOSING,
        issuedAt: AT,
      },
      [adjustment(-4_500_000n, 'manager-1')],
      TX,
    );
  });

  it('cancelled after the holding fee is paid: keeps it and voids only the balance', async () => {
    invoices.firstChargeableInvoice.mockResolvedValue({
      ...FIRST,
      lines: [
        line(1, InvoiceLineType.HOLDING_FEE, 2_250_000n, 2_250_000n),
        line(2, InvoiceLineType.TERM_BALANCE, 2_250_000n, 0n),
      ],
    });

    await service.settleCancellation(CONTRACT, null, TX, AT);

    expect(invoices.insert).toHaveBeenCalledWith(
      expect.anything(),
      [adjustment(-2_250_000n, null)],
      TX,
    );
  });

  it('appends to an existing closing invoice', async () => {
    const closing = { id: 'closing-0' };
    invoices.lockClosingInvoice.mockResolvedValue(closing);

    await expect(service.settleCancellation(CONTRACT, 'staff-1', TX, AT)).resolves.toEqual(closing);
    expect(invoices.appendLines).toHaveBeenCalledWith(
      closing,
      [adjustment(-4_500_000n, 'staff-1')],
      TX,
    );
    expect(invoices.insert).not.toHaveBeenCalled();
  });

  it('does nothing when no invoice was issued, a cancellation from REQUESTED', async () => {
    invoices.firstChargeableInvoice.mockResolvedValue(null);
    await expect(service.settleCancellation(CONTRACT, null, TX, AT)).resolves.toBeNull();
    expect(invoices.lockClosingInvoice).not.toHaveBeenCalled();
  });

  it('does nothing when the first invoice is already paid in full', async () => {
    invoices.firstChargeableInvoice.mockResolvedValue({
      ...FIRST,
      lines: [line(1, InvoiceLineType.DAY_PLAN_FEE, 720_000n, 720_000n)],
    });
    await expect(service.settleCancellation(CONTRACT, null, TX)).resolves.toBeNull();
    expect(invoices.insert).not.toHaveBeenCalled();
  });

  it('adjusts at the current time by default', async () => {
    const before = Date.now();
    await service.settleCancellation(CONTRACT, null, TX);
    const [, [made]] = invoices.insert.mock.calls[0] as [unknown, { dueAt: Date }[]];
    expect(made.dueAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
