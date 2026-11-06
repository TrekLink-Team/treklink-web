import { InvoiceKind, InvoiceLineType, InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { BalanceService } from './balance.service';
import { InvoicesRepository } from './invoices.repository';
import { PaymentsRepository } from './payments.repository';
import { PAYMENT_CONFIRMED, PaymentsService } from './payments.service';

const AT = new Date('2026-10-26T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

const INVOICE = {
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
    {
      id: 'l-1',
      invoiceId: 'inv-1',
      seq: 1,
      type: InvoiceLineType.HOLDING_FEE,
      amountVnd: 2_250_000n,
      paidVnd: 0n,
      dueAt: AT,
    },
  ],
};

const INPUT = { method: PaymentMethod.CASH, amountVnd: 2_250_000n, reference: 'RCPT-2026-0193' };

describe('PaymentsService.recordCounter (billing task 3.1, REQ-EVT-10, UC-22)', () => {
  let invoices: Record<string, jest.Mock>;
  let payments: Record<string, jest.Mock>;
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let balances: { balanceSummary: jest.Mock };
  let service: PaymentsService;

  beforeEach(() => {
    invoices = {
      lockWithLines: jest.fn().mockResolvedValue(INVOICE),
      applyPayment: jest.fn().mockResolvedValue({ ...INVOICE, paidVnd: 2_250_000n }),
    };
    payments = {
      referenceExists: jest.fn().mockResolvedValue(false),
      insertCounterPayment: jest.fn().mockResolvedValue({ id: 'p-1' }),
      confirmedOfContract: jest.fn().mockResolvedValue([
        {
          reference: 'RCPT-2026-0193',
          amountVnd: 2_250_000n,
          method: PaymentMethod.CASH,
          confirmedAt: AT,
          invoice: { number: 'INV-2026-000123' },
        },
      ]),
    };
    events = {
      transaction: jest.fn((work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX)),
      emitAfterCommit: jest.fn(),
    };
    balances = { balanceSummary: jest.fn().mockResolvedValue({ owedToOrganizationVnd: 0n }) };
    service = new PaymentsService(
      invoices as unknown as InvoicesRepository,
      payments as unknown as PaymentsRepository,
      events as unknown as TransactionalEvents,
      balances as unknown as BalanceService,
    );
  });

  it('lists the confirmed payments of a contract with their invoice number (handover note)', async () => {
    await expect(service.receivedOfContract('c-1', TX)).resolves.toEqual([
      {
        invoiceNumber: 'INV-2026-000123',
        amountVnd: 2_250_000n,
        method: PaymentMethod.CASH,
        reference: 'RCPT-2026-0193',
        confirmedAt: AT,
      },
    ]);
    expect(payments.confirmedOfContract).toHaveBeenCalledWith('c-1', TX);
  });

  it('records a confirmed payment, applies it to the invoice, and emits after commit', async () => {
    await expect(service.recordCounter('inv-1', INPUT, STAFF, AT)).resolves.toEqual({ id: 'p-1' });

    expect(invoices.lockWithLines).toHaveBeenCalledWith('inv-1', TX);
    expect(payments.referenceExists).toHaveBeenCalledWith('RCPT-2026-0193', TX);
    expect(payments.insertCounterPayment).toHaveBeenCalledWith(
      {
        reference: 'RCPT-2026-0193',
        organizationId: 'org-1',
        contractId: 'c-1',
        invoiceId: 'inv-1',
        amountVnd: 2_250_000n,
        method: PaymentMethod.CASH,
        recordedById: 'staff-1',
        confirmedAt: AT,
      },
      TX,
    );
    expect(invoices.applyPayment).toHaveBeenCalledWith(INVOICE, 2_250_000n, TX);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(PAYMENT_CONFIRMED, {
      paymentId: 'p-1',
      invoiceId: 'inv-1',
      contractId: 'c-1',
      organizationId: 'org-1',
      amountVnd: 2_250_000n,
      method: PaymentMethod.CASH,
      at: AT,
    });
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({
        actorId: 'staff-1',
        action: 'payment.recordCounter',
        subjectType: 'Payment',
        subjectId: 'p-1',
      }),
    );
  });

  it('accepts exactly the amount still due on a partly paid invoice', async () => {
    invoices.lockWithLines.mockResolvedValue({ ...INVOICE, paidVnd: 4_000_000n });
    await service.recordCounter('inv-1', { ...INPUT, amountVnd: 500_000n }, STAFF, AT);
    expect(invoices.applyPayment).toHaveBeenCalled();
  });

  it('answers 404 for an unknown invoice', async () => {
    invoices.lockWithLines.mockResolvedValue(null);
    await expect(service.recordCounter('inv-x', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
      message: 'Invoice not found.',
    });
  });

  it('records nothing for a known reference (409 DUPLICATE_REFERENCE, E01-6)', async () => {
    payments.referenceExists.mockResolvedValue(true);
    await expect(service.recordCounter('inv-1', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.DUPLICATE_REFERENCE,
      message: 'RCPT-2026-0193 is already registered.',
    });
    expect(payments.insertCounterPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['more than the invoice owes', INVOICE, 4_500_001n, 4_500_000n],
    ['anything on a paid invoice', { ...INVOICE, paidVnd: 4_500_000n }, 1n, 0n],
  ])('refuses %s with 400 OVERPAYMENT', async (_label, invoice, amountVnd, due) => {
    invoices.lockWithLines.mockResolvedValue(invoice);
    await expect(
      service.recordCounter('inv-1', { ...INPUT, amountVnd }, STAFF, AT),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.OVERPAYMENT,
      message: `amountVnd must be between 1 and ${due}.`,
    });
    expect(payments.insertCounterPayment).not.toHaveBeenCalled();
  });

  it('turns a reference taken at the same moment on another invoice into DUPLICATE_REFERENCE', async () => {
    payments.insertCounterPayment.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.recordCounter('inv-1', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.DUPLICATE_REFERENCE,
    });
  });

  it('rethrows any other failure, and records at the current time by default', async () => {
    payments.insertCounterPayment.mockRejectedValueOnce(new Error('database down'));
    await expect(service.recordCounter('inv-1', INPUT, STAFF)).rejects.toThrow('database down');

    const before = Date.now();
    await service.recordCounter('inv-1', INPUT, STAFF);
    const [[made]] = payments.insertCounterPayment.mock.calls.slice(-1) as [
      [{ confirmedAt: Date }],
    ];
    expect(made.confirmedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  // REQ-EVT-17, REQ-ERR-09, AC-11, AC-12 (billing design section 11.4, D-097 amended).
  describe('markRefunded', () => {
    const CLOSING = {
      ...INVOICE,
      id: 'inv-9',
      kind: InvoiceKind.CLOSING,
      termId: null,
      status: InvoiceStatus.CREDIT_DUE,
      totalVnd: -720_000n,
      lines: [],
    };

    it('records the credit due with the note and audits after commit (AC-11)', async () => {
      invoices.lockWithLines.mockResolvedValue(CLOSING);
      balances.balanceSummary.mockResolvedValue({ owedToOrganizationVnd: 720_000n });
      invoices.markRefunded = jest
        .fn()
        .mockResolvedValue({ ...CLOSING, status: InvoiceStatus.REFUNDED, refundedVnd: 720_000n });
      await service.markRefunded('inv-9', '  Bank transfer FT26110600042 ', STAFF, AT);
      expect(balances.balanceSummary).toHaveBeenCalledWith('c-1', AT, TX);
      expect(invoices.markRefunded).toHaveBeenCalledWith(
        'inv-9',
        { amountVnd: 720_000n, at: AT, byId: 'staff-1', note: 'Bank transfer FT26110600042' },
        TX,
      );
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({ action: 'invoice.refunded', subjectId: 'inv-9' }),
      );
    });

    it('records only what is owed when other lines took part of the credit', async () => {
      invoices.lockWithLines.mockResolvedValue(CLOSING);
      balances.balanceSummary.mockResolvedValue({ owedToOrganizationVnd: 300_000n });
      invoices.markRefunded = jest.fn().mockResolvedValue(CLOSING);
      await service.markRefunded('inv-9', 'Cash at the counter', STAFF, AT);
      expect(invoices.markRefunded).toHaveBeenCalledWith(
        'inv-9',
        expect.objectContaining({ amountVnd: 300_000n }),
        TX,
      );
    });

    it('answers NOTHING_OWED while the credit is set against unpaid lines (AC-12)', async () => {
      invoices.lockWithLines.mockResolvedValue(CLOSING);
      invoices.markRefunded = jest.fn();
      await expect(service.markRefunded('inv-9', 'note', STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOTHING_OWED,
      });
      expect(invoices.markRefunded).not.toHaveBeenCalled();
    });

    it('refuses an invoice that is not CREDIT_DUE, and an unknown one', async () => {
      invoices.lockWithLines.mockResolvedValue({ ...CLOSING, status: InvoiceStatus.REFUNDED });
      await expect(service.markRefunded('inv-9', 'note', STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      invoices.lockWithLines.mockResolvedValue(null);
      await expect(service.markRefunded('inv-9', 'note', STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });
});
