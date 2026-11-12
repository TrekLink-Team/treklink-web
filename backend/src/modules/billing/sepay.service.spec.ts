import { ConfigService } from '@nestjs/config';
import {
  InvoiceKind,
  InvoiceLineType,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { BalanceService } from './balance.service';
import { InvoicesRepository } from './invoices.repository';
import { PaymentsRepository } from './payments.repository';
import { PAYMENT_CONFIRMED } from './payments.service';
import { RELEASE_ADJUSTMENT_PREFIX } from './release-adjustments';
import { amountToRequest, newReference, SepayService } from './sepay.service';

const AT = new Date('2026-11-02T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const OTHER: Caller = { id: 'u-x', roles: ['ORG_MANAGER'], organizationId: 'org-2' };
const KEY = 'sandbox-key-123';

const line = (
  seq: number,
  type: InvoiceLineType,
  amountVnd: bigint,
  paidVnd: bigint,
  dueAt: string,
  description: string = type,
) => ({
  seq,
  type,
  description,
  quantity: 1,
  unitVnd: amountVnd,
  amountVnd,
  dueAt: new Date(dueAt),
  paidVnd,
});

const invoice = (
  lines = [
    line(1, InvoiceLineType.HOLDING_FEE, 1_125_000n, 0n, '2026-11-02T02:00:00.000Z'),
    line(2, InvoiceLineType.TERM_BALANCE, 1_125_000n, 0n, '2026-12-02T02:00:00.000Z'),
  ],
) => ({
  id: 'inv-1',
  number: 'INV-2026-000001',
  organizationId: 'org-1',
  contractId: 'c-1',
  termId: 't-1',
  kind: InvoiceKind.TERM,
  status: InvoiceStatus.ISSUED,
  totalVnd: lines.reduce((total, item) => total + item.amountVnd, 0n),
  paidVnd: lines.reduce((total, item) => total + item.paidVnd, 0n),
  issuedAt: AT,
  refundedVnd: null,
  refundedAt: null,
  refundedById: null,
  refundNote: null,
  lines,
});

const pending = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  reference: 'TL7K2Q9M4D',
  invoiceId: 'inv-1',
  contractId: 'c-1',
  organizationId: 'org-1',
  amountVnd: 1_125_000n,
  method: PaymentMethod.SEPAY,
  status: PaymentStatus.PENDING,
  isSandbox: true,
  expiresAt: new Date('2026-11-02T03:30:00.000Z'),
  confirmedAt: null,
  ...overrides,
});

describe('SePay sandbox (billing task 3.2)', () => {
  let invoices: Record<string, jest.Mock>;
  let balance: { outstanding: jest.Mock };
  let payments: Record<string, jest.Mock>;
  let emitAfterCommit: jest.Mock;
  let key: string | undefined;
  let service: SepayService;

  beforeEach(() => {
    key = KEY;
    invoices = {
      lockWithLines: jest.fn().mockResolvedValue(invoice()),
      applyPayment: jest.fn().mockResolvedValue(undefined),
    };
    balance = { outstanding: jest.fn().mockResolvedValue(2_250_000n) };
    payments = {
      lockInvoiceRequests: jest.fn().mockResolvedValue(undefined),
      findPendingSepay: jest.fn().mockResolvedValue(null),
      expireIfDue: jest.fn().mockImplementation((row: object) => Promise.resolve(row)),
      receivedFor: jest.fn().mockResolvedValue([]),
      insertSepayPayment: jest
        .fn()
        .mockImplementation((data: object) => Promise.resolve({ ...pending(), ...data })),
      findById: jest.fn().mockResolvedValue(pending()),
      gatewayTxnExists: jest.fn().mockResolvedValue(false),
      lockByReference: jest.fn().mockResolvedValue(pending()),
      confirmSepay: jest.fn().mockResolvedValue(pending({ status: PaymentStatus.CONFIRMED })),
      insertReceivedSepay: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ ...pending({ status: PaymentStatus.CONFIRMED }), ...data }),
        ),
      expireDue: jest.fn().mockResolvedValue(2),
    };
    emitAfterCommit = jest.fn();
    const config = {
      get: (name: string) =>
        ({
          SEPAY_QR_BASE_URL: 'https://qr.sepay.vn/img',
          SEPAY_BANK_CODE: 'MBBank',
          SEPAY_WEBHOOK_API_KEY: key,
        })[name],
    };
    const parameters = {
      get: jest.fn((name: string) =>
        Promise.resolve(name === 'billing.sepayPaymentTtlMinutes' ? 30 : '0123456789'),
      ),
    };
    service = new SepayService(
      invoices as unknown as InvoicesRepository,
      balance as unknown as BalanceService,
      payments as unknown as PaymentsRepository,
      parameters as unknown as ParameterService,
      {
        transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
        emitAfterCommit,
      } as unknown as TransactionalEvents,
      config as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  it('makes references of TL and eight Crockford base32 characters', () => {
    for (let i = 0; i < 50; i += 1) expect(newReference()).toMatch(/^TL[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  describe('the amount a request asks for', () => {
    it('takes the lines due now, or one line when asked', () => {
      expect(amountToRequest(invoice(), undefined, AT)).toBe(1_125_000n);
      expect(amountToRequest(invoice(), 2, AT)).toBe(1_125_000n);
    });

    it('falls back to the earliest unpaid line before anything is due', () => {
      expect(amountToRequest(invoice(), undefined, new Date('2026-10-30T00:00:00.000Z'))).toBe(
        1_125_000n,
      );
    });

    it('never asks for more than the invoice still owes after an adjustment', () => {
      const adjusted = invoice([
        line(1, InvoiceLineType.HOLDING_FEE, 1_125_000n, 0n, '2026-11-02T02:00:00.000Z'),
        line(2, InvoiceLineType.ADJUSTMENT, -1_000_000n, 0n, '2026-11-02T02:00:00.000Z'),
      ]);
      expect(amountToRequest(adjusted, undefined, AT)).toBe(125_000n);
    });

    it('uses each fee net of its own release adjustment before and after the start', () => {
      const adjusted = invoice([
        ...invoice().lines,
        {
          ...line(3, InvoiceLineType.ADJUSTMENT, -225_000n, 0n, '2026-11-02T02:00:00.000Z'),
          description: `${RELEASE_ADJUSTMENT_PREFIX}holding fee, 5 to 4 units`,
        },
        {
          ...line(4, InvoiceLineType.ADJUSTMENT, -225_000n, 0n, '2026-12-02T02:00:00.000Z'),
          description: `${RELEASE_ADJUSTMENT_PREFIX}term balance, 5 to 4 units`,
        },
      ]);
      expect(amountToRequest(adjusted, undefined, new Date('2026-10-30T00:00:00Z'))).toBe(900_000n);
      expect(amountToRequest(adjusted, undefined, AT)).toBe(900_000n);
      expect(amountToRequest(adjusted, 1, AT)).toBe(900_000n);
      expect(amountToRequest(adjusted, 2, AT)).toBe(900_000n);
    });
  });

  describe('request (api-design 11)', () => {
    it('creates a PENDING sandbox payment expiring after the TTL', async () => {
      const payment = await service.request('inv-1', undefined, MANAGER, AT);
      expect(payments.insertSepayPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'inv-1',
          amountVnd: 1_125_000n,
          requestedById: 'u-mgr',
          expiresAt: new Date('2026-11-02T03:30:00.000Z'),
        }),
        TX,
      );
      expect(payment.reference).toMatch(/^TL/);
      // The waiting check runs under the per-invoice lock, in the insert's transaction.
      expect(payments.lockInvoiceRequests).toHaveBeenCalledWith('inv-1', TX);
      expect(payments.findPendingSepay).toHaveBeenCalledWith('inv-1', AT, TX);
      expect(payments.lockInvoiceRequests.mock.invocationCallOrder[0]).toBeLessThan(
        payments.findPendingSepay.mock.invocationCallOrder[0],
      );
    });

    it('creates nothing when a waiting request is found under the lock (review of #92)', async () => {
      payments.findPendingSepay.mockResolvedValueOnce(pending());
      await expect(service.request('inv-1', undefined, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.PAYMENT_PENDING,
      });
      expect(payments.insertSepayPayment).not.toHaveBeenCalled();
    });

    it('refuses a settled contract even when the invoice still shows unpaid lines', async () => {
      balance.outstanding.mockResolvedValueOnce(0n);
      await expect(service.request('inv-1', undefined, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOTHING_DUE,
      });
      expect(balance.outstanding).toHaveBeenCalledWith('c-1', TX);
      expect(payments.insertSepayPayment).not.toHaveBeenCalled();
    });

    it('refuses while another request waits, when nothing is due, and for another organization', async () => {
      payments.findPendingSepay.mockResolvedValueOnce(pending());
      await expect(service.request('inv-1', undefined, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.PAYMENT_PENDING,
      });
      invoices.lockWithLines.mockResolvedValueOnce(
        invoice([
          line(1, InvoiceLineType.HOLDING_FEE, 1_125_000n, 1_125_000n, '2026-11-02T02:00:00.000Z'),
        ]),
      );
      await expect(service.request('inv-1', undefined, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOTHING_DUE,
      });
      await expect(service.request('inv-1', undefined, OTHER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  it('shows no QR once the request is confirmed or expired (api-design 15)', async () => {
    await expect(
      service.vietQr(pending({ status: PaymentStatus.CONFIRMED }) as never),
    ).resolves.toBeNull();
    await expect(
      service.vietQr(pending({ status: PaymentStatus.EXPIRED }) as never),
    ).resolves.toBeNull();
  });

  it('expires a stale request on read and lists money recorded for its reference (review of #92)', async () => {
    payments.expireIfDue.mockResolvedValueOnce(pending({ status: PaymentStatus.EXPIRED }));
    payments.receivedFor.mockResolvedValueOnce([{ amountVnd: 500_000n, confirmedAt: AT }]);
    const found = await service.find('p-1', MANAGER, AT);
    expect(payments.expireIfDue).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-1' }), AT);
    expect(found.status).toBe(PaymentStatus.EXPIRED);
    expect(found.receivedLater).toEqual([{ amountVnd: 500_000n, confirmedAt: AT }]);
    expect(payments.receivedFor).toHaveBeenCalledWith('TL7K2Q9M4D');
  });

  it('builds the VietQR URL from configuration and the receiving account', async () => {
    await expect(service.vietQr(pending() as never)).resolves.toEqual({
      imageUrl: 'https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=1125000&des=TL7K2Q9M4D',
      bankAccount: '0123456789',
      content: 'TL7K2Q9M4D',
    });
  });

  describe('handleWebhook (api-design 12, AC-03)', () => {
    const hook = {
      id: 92704,
      transferType: 'in',
      transferAmount: 1_125_000,
      content: 'CK TL7K2Q9M4D',
    };

    it('refuses a missing or wrong key with 401 and records nothing', async () => {
      await expect(service.handleWebhook(undefined, hook, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.WEBHOOK_UNAUTHENTICATED,
      });
      await expect(service.handleWebhook('Apikey wrong', hook, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.WEBHOOK_UNAUTHENTICATED,
      });
      key = undefined;
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.WEBHOOK_UNAUTHENTICATED,
      });
      expect(payments.lockByReference).not.toHaveBeenCalled();
    });

    it('confirms the matching request, applies it and emits payment.confirmed', async () => {
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).resolves.toBe('confirmed');
      expect(payments.confirmSepay).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({ gatewayTxnId: '92704', confirmedAt: AT }),
        TX,
      );
      expect(invoices.applyPayment).toHaveBeenCalledWith(expect.anything(), 1_125_000n, TX);
      expect(emitAfterCommit).toHaveBeenCalledWith(
        PAYMENT_CONFIRMED,
        expect.objectContaining({ paymentId: 'p-1', amountVnd: 1_125_000n }),
      );
    });

    it('answers a repeated delivery without applying it twice', async () => {
      payments.gatewayTxnExists.mockResolvedValueOnce(true);
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).resolves.toBe('duplicate');
      expect(invoices.applyPayment).not.toHaveBeenCalled();
    });

    it('records another transfer on a confirmed reference and deduplicates only its transaction id', async () => {
      payments.lockByReference.mockResolvedValueOnce(pending({ status: PaymentStatus.CONFIRMED }));
      const second = { ...hook, id: 92705 };
      await expect(service.handleWebhook(`Apikey ${KEY}`, second, AT)).resolves.toBe('recorded');
      expect(payments.confirmSepay).not.toHaveBeenCalled();
      expect(payments.insertReceivedSepay).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'TL7K2Q9M4D-92705',
          gatewayTxnId: '92705',
          amountVnd: 1_125_000n,
        }),
        TX,
      );
      expect(invoices.applyPayment).toHaveBeenCalledTimes(1);
      payments.gatewayTxnExists.mockResolvedValueOnce(true);
      await expect(service.handleWebhook(`Apikey ${KEY}`, second, AT)).resolves.toBe('duplicate');
      expect(payments.insertReceivedSepay).toHaveBeenCalledTimes(1);
      expect(invoices.applyPayment).toHaveBeenCalledTimes(1);
    });

    it('confirms an expired request itself when its exact amount arrives late (review of #92)', async () => {
      payments.lockByReference.mockResolvedValueOnce(pending({ status: PaymentStatus.EXPIRED }));
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).resolves.toBe('confirmed');
      expect(payments.confirmSepay).toHaveBeenCalledWith('p-1', expect.anything(), TX);
      expect(payments.insertReceivedSepay).not.toHaveBeenCalled();
    });

    it('answers a concurrent replay as duplicate when the gateway transaction unique index rejects it', async () => {
      payments.lockByReference.mockResolvedValueOnce(pending({ status: PaymentStatus.CONFIRMED }));
      payments.insertReceivedSepay.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('gateway transaction already recorded', {
          code: 'P2002',
          clientVersion: '6.4.1',
        }),
      );
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).resolves.toBe('duplicate');
      expect(invoices.applyPayment).not.toHaveBeenCalled();
    });

    it('records a different amount as its own payment of what arrived', async () => {
      await expect(
        service.handleWebhook(`Apikey ${KEY}`, { ...hook, transferAmount: 500_000 }, AT),
      ).resolves.toBe('recorded');
      expect(payments.insertReceivedSepay).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'TL7K2Q9M4D-92704', amountVnd: 500_000n }),
        TX,
      );
      expect(invoices.applyPayment).toHaveBeenCalledWith(expect.anything(), 500_000n, TX);
    });

    it('answers an unknown reference or an outgoing transfer with success and records nothing', async () => {
      payments.lockByReference.mockResolvedValueOnce(null);
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).resolves.toBe('unknown');
      await expect(
        service.handleWebhook(`Apikey ${KEY}`, { ...hook, transferType: 'out' }, AT),
      ).resolves.toBe('ignored');
      await expect(
        service.handleWebhook(`Apikey ${KEY}`, { ...hook, content: 'no reference' }, AT),
      ).resolves.toBe('unknown');
      expect(invoices.applyPayment).not.toHaveBeenCalled();
    });
  });

  describe('edge cases (TK-211 unit coverage)', () => {
    const hook = {
      id: 92705,
      transferType: 'in',
      transferAmount: 1_125_000,
      content: 'CK TL7K2Q9M4D',
    };

    it('rejects a lineSeq that is not a line of the invoice', () => {
      let thrown: unknown;
      try {
        amountToRequest(invoice(), 99, AT);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    });

    it('shows no QR for a payment recorded by another method', async () => {
      await expect(
        service.vietQr(pending({ method: PaymentMethod.CASH }) as never),
      ).resolves.toBeNull();
    });

    it('answers NOT_FOUND for a missing payment and for another organization, before expiring it', async () => {
      payments.findById.mockResolvedValueOnce(null);
      await expect(service.find('p-x', MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      await expect(service.find('p-1', OTHER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(payments.expireIfDue).not.toHaveBeenCalled();
    });

    it('lets Staff read any payment and skips the reference lookup for a non-SePay payment', async () => {
      payments.findById.mockResolvedValueOnce(pending({ method: PaymentMethod.CASH }));
      const staff: Caller = { id: 's-1', roles: ['STAFF'], organizationId: null };
      await expect(service.find('p-1', staff, AT)).resolves.toMatchObject({ receivedLater: [] });
      expect(payments.receivedFor).not.toHaveBeenCalled();
    });

    it('reads the reference from the description when the content is empty', async () => {
      await expect(
        service.handleWebhook(
          `Apikey ${KEY}`,
          { ...hook, content: null, description: 'MBVCB TL7K2Q9M4D' },
          AT,
        ),
      ).resolves.toBe('confirmed');
      expect(payments.lockByReference).toHaveBeenCalledWith('TL7K2Q9M4D', TX);
    });

    it('applies only what the invoice still owes and keeps the excess on the payment', async () => {
      invoices.lockWithLines.mockResolvedValueOnce(
        invoice([
          line(1, InvoiceLineType.HOLDING_FEE, 1_125_000n, 1_000_000n, '2026-11-02T02:00:00.000Z'),
        ]),
      );
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).resolves.toBe('confirmed');
      expect(invoices.applyPayment).toHaveBeenCalledWith(expect.anything(), 125_000n, TX);
      expect(emitAfterCommit).toHaveBeenCalledWith(
        PAYMENT_CONFIRMED,
        expect.objectContaining({ amountVnd: 1_125_000n }),
      );
    });

    it('confirms the money without applying it when the invoice is settled or gone', async () => {
      invoices.lockWithLines.mockResolvedValueOnce(
        invoice([
          line(1, InvoiceLineType.HOLDING_FEE, 1_125_000n, 1_125_000n, '2026-11-02T02:00:00.000Z'),
        ]),
      );
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).resolves.toBe('confirmed');
      invoices.lockWithLines.mockResolvedValueOnce(null);
      await expect(
        service.handleWebhook(`Apikey ${KEY}`, { ...hook, id: 92706 }, AT),
      ).resolves.toBe('confirmed');
      expect(invoices.applyPayment).not.toHaveBeenCalled();
      expect(payments.confirmSepay).toHaveBeenCalledTimes(2);
    });

    it('rethrows a failure other than the unique index so the webhook is retried', async () => {
      payments.confirmSepay.mockRejectedValueOnce(new Error('connection reset'));
      await expect(service.handleWebhook(`Apikey ${KEY}`, hook, AT)).rejects.toThrow(
        'connection reset',
      );
      expect(emitAfterCommit).not.toHaveBeenCalled();
    });
  });

  it('expires PENDING requests past their expiry (MSG25)', async () => {
    await expect(service.expirePayments(AT)).resolves.toBe(2);
    expect(payments.expireDue).toHaveBeenCalledWith(AT);
  });
});
