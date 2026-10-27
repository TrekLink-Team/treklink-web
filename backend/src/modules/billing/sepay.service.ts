import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ScheduledJob } from '../platform/scheduler/scheduled-job.decorator';
import { InvoiceDetailRow, InvoicesRepository } from './invoices.repository';
import { PaymentRow, PaymentsRepository } from './payments.repository';
import { PAYMENT_CONFIRMED, PaymentConfirmedEvent } from './payments.service';

const MINUTE_MS = 60_000;
// Crockford base32: no I, L, O or U, so a reference survives banks that alter transfer content.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REFERENCE = /TL[0-9A-HJKMNP-TV-Z]{8}/;
const MAX_REFERENCE_TRIES = 5;

export const newReference = (): string =>
  `TL${Array.from({ length: 8 }, () => CROCKFORD[randomInt(CROCKFORD.length)]).join('')}`;

// What the Org Manager's page needs to show the QR (api-design 11 and 15).
export interface VietQr {
  imageUrl: string;
  bankAccount: string;
  content: string;
}

// The fields of a SePay webhook billing reads (api-design 12, docs.sepay.vn/tich-hop-webhooks.html).
export interface SepayWebhook {
  id: number | string;
  transferType?: string;
  transferAmount: number;
  content?: string | null;
  description?: string | null;
  transactionDate?: string;
}

export type WebhookOutcome = 'confirmed' | 'recorded' | 'duplicate' | 'unknown' | 'ignored';

const unpaidOf = (line: { amountVnd: bigint; paidVnd: bigint }) =>
  line.amountVnd > line.paidVnd ? line.amountVnd - line.paidVnd : 0n;

// The amount a SePay request asks for: one line when `lineSeq` is given, otherwise every line due
// now. When nothing is due yet (an approved contract before its start date), the earliest unpaid
// line, so a holding fee can be paid in advance of the handover (FR-CON-05).
export const amountToRequest = (
  invoice: InvoiceDetailRow,
  lineSeq: number | undefined,
  at: Date,
): bigint => {
  if (lineSeq !== undefined) {
    const line = invoice.lines.find((item) => item.seq === lineSeq);
    if (!line) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'lineSeq is not a line of this invoice.',
      );
    }
    return unpaidOf(line);
  }
  const unpaid = invoice.lines.filter((line) => unpaidOf(line) > 0n);
  const dueNow = unpaid.filter((line) => line.dueAt.getTime() <= at.getTime());
  const chosen = dueNow.length > 0 ? dueNow : unpaid.slice(0, 1);
  const lineTotal = chosen.reduce((total, line) => total + unpaidOf(line), 0n);
  // A negative ADJUSTMENT line lowers what the invoice still owes; never ask for more than that.
  const invoiceDue = invoice.totalVnd > invoice.paidVnd ? invoice.totalVnd - invoice.paidVnd : 0n;
  return lineTotal < invoiceDue ? lineTotal : invoiceDue;
};

const sameKey = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// SePay sandbox payments (billing task 3.2, UC-19, FR-BILL-07, FR-BILL-09, BR-31, BR-34). Every
// SePay payment is a sandbox payment and is labelled so (D-033 item 9).
@Injectable()
export class SepayService {
  private readonly logger = new Logger(SepayService.name);

  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly payments: PaymentsRepository,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // The Org Manager asks to pay an invoice (api-design 11): a PENDING payment with a fresh
  // reference, expiring after `billing.sepayPaymentTtlMinutes`. 409 PAYMENT_PENDING while another
  // request of the invoice is still waiting; 409 NOTHING_DUE when nothing is left to pay.
  async request(
    invoiceId: string,
    lineSeq: number | undefined,
    caller: Caller,
    at: Date = new Date(),
  ): Promise<PaymentRow> {
    const invoice = await this.invoices.detail(invoiceId);
    if (
      !invoice ||
      (caller.organizationId !== null && caller.organizationId !== invoice.organizationId)
    ) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Invoice not found.');
    }
    if (await this.payments.findPendingSepay(invoiceId, at)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.PAYMENT_PENDING,
        'A payment for this invoice is already waiting. Use its QR code.',
      );
    }
    const amountVnd = amountToRequest(invoice, lineSeq, at);
    if (amountVnd <= 0n) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.NOTHING_DUE,
        'This invoice has nothing to pay.',
      );
    }
    const ttl = await this.parameters.get('billing.sepayPaymentTtlMinutes');
    const expiresAt = new Date(at.getTime() + ttl * MINUTE_MS);

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.events.transaction((tx) =>
          this.payments.insertSepayPayment(
            {
              reference: newReference(),
              organizationId: invoice.organizationId,
              contractId: invoice.contractId,
              invoiceId,
              amountVnd,
              requestedById: caller.id,
              expiresAt,
            },
            tx,
          ),
        );
      } catch (error) {
        const collision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collision || attempt >= MAX_REFERENCE_TRIES) throw error;
      }
    }
  }

  // The QR of a SePay payment: the configured VietQR image URL with account, bank, amount and the
  // reference as transfer content.
  async vietQr(payment: PaymentRow): Promise<VietQr | null> {
    if (payment.method !== PaymentMethod.SEPAY) return null;
    const account = await this.parameters.get('billing.sepayBankAccount');
    const bankAccount = typeof account === 'string' ? account : JSON.stringify(account);
    const url = new URL(this.config.get('SEPAY_QR_BASE_URL', { infer: true }));
    url.searchParams.set('acc', bankAccount);
    url.searchParams.set('bank', this.config.get('SEPAY_BANK_CODE', { infer: true }));
    url.searchParams.set('amount', payment.amountVnd.toString());
    url.searchParams.set('des', payment.reference);
    return { imageUrl: url.toString(), bankAccount, content: payment.reference };
  }

  // One payment for the polling page (api-design 15); another organization's is 404.
  async find(id: string, caller: Caller): Promise<PaymentRow> {
    const payment = await this.payments.findById(id);
    if (
      !payment ||
      (caller.organizationId !== null && caller.organizationId !== payment.organizationId)
    ) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Payment not found.');
    }
    return payment;
  }

  // The SePay webhook (api-design 12, D-038). The `Authorization: Apikey <key>` header is compared
  // in constant time; a missing or wrong key is 401 and records nothing. A transaction id or a
  // confirmed reference seen before answers success again without applying twice (AC-03); an
  // unknown reference is logged for Staff and answered success, so SePay stops retrying.
  async handleWebhook(
    authorization: string | undefined,
    hook: SepayWebhook,
    at: Date = new Date(),
  ): Promise<WebhookOutcome> {
    const key = this.config.get('SEPAY_WEBHOOK_API_KEY', { infer: true });
    const given = authorization?.replace(/^Apikey\s+/i, '') ?? '';
    if (!key || !authorization || !sameKey(given, key)) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.WEBHOOK_UNAUTHENTICATED,
        'Missing or wrong SePay API key.',
      );
    }
    if (hook.transferType && hook.transferType !== 'in') return 'ignored';
    const reference = REFERENCE.exec(`${hook.content ?? ''} ${hook.description ?? ''}`)?.[0];
    const gatewayTxnId = String(hook.id);
    if (!reference) {
      this.logger.warn(`SePay transfer ${gatewayTxnId} carries no TrekLink reference`);
      return 'unknown';
    }
    if (await this.payments.gatewayTxnExists(gatewayTxnId)) return 'duplicate';

    try {
      return await this.events.transaction(async (tx) => {
        const payment = await this.payments.lockByReference(reference, tx);
        if (!payment) {
          this.logger.warn(`SePay transfer ${gatewayTxnId} names unknown reference ${reference}`);
          return 'unknown';
        }
        if (payment.status === PaymentStatus.CONFIRMED) return 'duplicate';

        const received = BigInt(Math.trunc(hook.transferAmount));
        const settlement = {
          gatewayTxnId,
          gatewayPayload: hook as unknown as Prisma.InputJsonValue,
          confirmedAt: at,
        };
        const exact = payment.status === PaymentStatus.PENDING && received === payment.amountVnd;
        const confirmed = exact
          ? await this.payments.confirmSepay(payment.id, settlement, tx)
          : await this.payments.insertReceivedSepay(
              {
                reference: `${reference}-${gatewayTxnId}`.slice(0, 64),
                organizationId: payment.organizationId,
                contractId: payment.contractId,
                invoiceId: payment.invoiceId,
                amountVnd: received,
                ...settlement,
              },
              tx,
            );
        if (!exact) {
          this.logger.warn(
            `SePay transfer ${gatewayTxnId} for ${reference} received ${received} VND against a ${payment.status} request of ${payment.amountVnd} VND; recorded as its own payment`,
          );
        }
        await this.apply(confirmed, received, tx);
        this.events.emitAfterCommit(PAYMENT_CONFIRMED, {
          paymentId: confirmed.id,
          invoiceId: confirmed.invoiceId,
          contractId: confirmed.contractId,
          organizationId: confirmed.organizationId,
          amountVnd: received,
          method: PaymentMethod.SEPAY,
          at,
        } satisfies PaymentConfirmedEvent);
        this.events.emitAfterCommit(AUDIT_RECORD, {
          actorId: null,
          actorRoles: [],
          organizationId: confirmed.organizationId,
          action: 'payment.sepayConfirmed',
          subjectType: 'Payment',
          subjectId: confirmed.id,
          after: { reference: confirmed.reference, amountVnd: received.toString(), gatewayTxnId },
        } satisfies AuditRecordEvent);
        return exact ? 'confirmed' : 'recorded';
      });
    } catch (error) {
      // A second delivery of the same transfer at the same moment loses on the unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'duplicate';
      }
      throw error;
    }
  }

  // `billing.expirePayments` (design §5): every minute, PENDING requests past their expiry become
  // EXPIRED and settle nothing, so the amount stays due (MSG25).
  @ScheduledJob('billing.expirePayments', '0 * * * * *')
  async expirePayments(at: Date = new Date()): Promise<number> {
    const expired = await this.payments.expireDue(at);
    if (expired > 0) this.logger.log(`Expired ${expired} SePay payment request(s)`);
    return expired;
  }

  // Applies what arrived to the invoice's unpaid lines, oldest due first, up to what it still owes;
  // anything above is kept on the payment row and logged for Staff.
  private async apply(payment: PaymentRow, received: bigint, tx: Prisma.TransactionClient) {
    const invoice = await this.invoices.lockWithLines(payment.invoiceId, tx);
    if (!invoice) return;
    const due = invoice.totalVnd > invoice.paidVnd ? invoice.totalVnd - invoice.paidVnd : 0n;
    const applied = received < due ? received : due;
    if (applied > 0n) await this.invoices.applyPayment(invoice, applied, tx);
    if (received > applied) {
      this.logger.warn(
        `SePay payment ${payment.reference} exceeds the invoice by ${received - applied} VND`,
      );
    }
  }
}
