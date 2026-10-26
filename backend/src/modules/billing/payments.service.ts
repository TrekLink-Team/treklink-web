import { HttpStatus, Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { InvoicesRepository } from './invoices.repository';
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
  ) {}

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
