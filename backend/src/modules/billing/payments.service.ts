import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import type { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { BalanceService, creditDueOf } from './balance.service';
import { InvoiceRow, InvoicesRepository } from './invoices.repository';
import { PaymentRow, PaymentsRepository } from './payments.repository';

export const PAYMENT_CONFIRMED = 'payment.confirmed';

export interface PaymentConfirmedEvent {
  paymentId: string;
  invoiceId: string;
  contractId: string;
  organizationId: string;
  amountVnd: bigint;
  method: PaymentMethod;
  at: Date;
}

export interface CounterPaymentInput {
  method: typeof PaymentMethod.CASH | typeof PaymentMethod.BANK_TRANSFER;
  amountVnd: bigint;
  reference: string;
}

// One confirmed payment as the handover note lists it (rentals design §4.1).
export interface ReceivedPayment {
  invoiceNumber: string;
  amountVnd: bigint;
  method: PaymentMethod;
  reference: string;
  confirmedAt: Date | null;
}

const duplicate = (reference: string) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.DUPLICATE_REFERENCE,
    `${reference} is already registered.`,
  );

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// Payments recorded against an invoice (billing task 3.1, REQ-EVT-10, FR-BILL-08, BR-31). SePay
// payments (3.2) join this service later.
@Injectable()
export class PaymentsService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly payments: PaymentsRepository,
    private readonly events: TransactionalEvents,
    private readonly balances: BalanceService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // REQ-EVT-17 (design section 11.4, D-097 amended): the credit due on a CREDIT_DUE invoice was refunded
  // outside TrekLink. Records the amount owed at that moment with the note, under the invoice lock.
  async markRefunded(
    invoiceId: string,
    note: string,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<InvoiceRow> {
    return this.events.transaction(async (tx) => {
      const invoice = await this.invoices.lockWithLines(invoiceId, tx);
      if (!invoice) {
        throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Invoice not found.');
      }
      if (invoice.status !== InvoiceStatus.CREDIT_DUE) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          'Only an invoice with a credit due can be marked refunded.',
        );
      }
      const { owedToOrganizationVnd } = await this.balances.balanceSummary(
        invoice.contractId,
        at,
        tx,
      );
      const amountVnd = creditDueOf(invoice.totalVnd, owedToOrganizationVnd);
      if (amountVnd <= 0n) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.NOTHING_OWED,
          'Nothing is owed to the organization on this invoice yet: the credit is set against its unpaid invoices.',
        );
      }
      const refunded = await this.invoices.markRefunded(
        invoice.id,
        { amountVnd, at, byId: actor.id, note: note.trim() },
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: invoice.organizationId,
        action: 'invoice.refunded',
        subjectType: 'Invoice',
        subjectId: invoice.id,
        before: { status: invoice.status },
        after: { status: refunded.status, refundedVnd: amountVnd.toString(), note: note.trim() },
      } satisfies AuditRecordEvent);
      return refunded;
    });
  }

  // The payments of a contract confirmed so far, oldest first, with the invoice each one paid: the
  // payment section of the handover note (rentals design §4.1). In the caller's transaction when it
  // passes one.
  async receivedOfContract(
    contractId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ReceivedPayment[]> {
    const rows = await this.payments.confirmedOfContract(contractId, tx);
    return rows.map((row) => ({
      invoiceNumber: row.invoice.number,
      amountVnd: row.amountVnd,
      method: row.method,
      reference: row.reference,
      confirmedAt: row.confirmedAt,
    }));
  }

  // A cash or bank-transfer payment received at the counter (UC-22, api-design 13): confirmed at
  // once and applied to the invoice's unpaid lines oldest due first, under a lock on the invoice so
  // two concurrent payments never over-apply. A known reference records nothing (409
  // DUPLICATE_REFERENCE, E01-6); more than the invoice still owes is 400 OVERPAYMENT.
  async recordCounter(
    invoiceId: string,
    input: CounterPaymentInput,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<PaymentRow> {
    try {
      return await this.events.transaction(async (tx) => {
        const invoice = await this.invoices.lockWithLines(invoiceId, tx);
        if (!invoice) {
          throw new DomainException(
            HttpStatus.NOT_FOUND,
            ErrorCode.NOT_FOUND,
            'Invoice not found.',
          );
        }
        if (await this.payments.referenceExists(input.reference, tx)) {
          throw duplicate(input.reference);
        }
        const dueVnd = invoice.totalVnd > invoice.paidVnd ? invoice.totalVnd - invoice.paidVnd : 0n;
        if (input.amountVnd > dueVnd) {
          throw new DomainException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.OVERPAYMENT,
            `amountVnd must be between 1 and ${dueVnd}.`,
          );
        }

        const payment = await this.payments.insertCounterPayment(
          {
            reference: input.reference,
            organizationId: invoice.organizationId,
            contractId: invoice.contractId,
            invoiceId: invoice.id,
            amountVnd: input.amountVnd,
            method: input.method,
            recordedById: actor.id,
            confirmedAt: at,
            // Match EnvironmentBadge, independently of NODE_ENV and the payment provider.
            isSandbox:
              (this.config.get<string>('VITE_APP_ENV')?.toLowerCase() || 'sandbox') !==
              'production',
          },
          tx,
        );
        await this.invoices.applyPayment(invoice, input.amountVnd, tx);

        this.events.emitAfterCommit(PAYMENT_CONFIRMED, {
          paymentId: payment.id,
          invoiceId: invoice.id,
          contractId: invoice.contractId,
          organizationId: invoice.organizationId,
          amountVnd: input.amountVnd,
          method: input.method,
          at,
        } satisfies PaymentConfirmedEvent);
        this.events.emitAfterCommit(AUDIT_RECORD, {
          actorId: actor.id,
          actorRoles: actor.roles,
          organizationId: invoice.organizationId,
          action: 'payment.recordCounter',
          subjectType: 'Payment',
          subjectId: payment.id,
          after: {
            invoiceId: invoice.id,
            reference: input.reference,
            method: input.method,
            amountVnd: input.amountVnd.toString(),
          },
        } satisfies AuditRecordEvent);
        return payment;
      });
    } catch (error) {
      // The same reference recorded at once on another invoice loses on the unique index.
      if (isUniqueViolation(error)) throw duplicate(input.reference);
      throw error;
    }
  }
}
