import { Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const PAYMENT_SELECT = {
  id: true,
  reference: true,
  invoiceId: true,
  contractId: true,
  organizationId: true,
  amountVnd: true,
  method: true,
  status: true,
  isSandbox: true,
  expiresAt: true,
  confirmedAt: true,
} satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export interface NewCounterPayment {
  reference: string;
  organizationId: string;
  contractId: string;
  invoiceId: string;
  amountVnd: bigint;
  method: typeof PaymentMethod.CASH | typeof PaymentMethod.BANK_TRANSFER;
  recordedById: string;
  confirmedAt: Date;
}

export interface NewSepayPayment {
  reference: string;
  organizationId: string;
  contractId: string;
  invoiceId: string;
  amountVnd: bigint;
  requestedById: string;
  expiresAt: Date;
}

export interface Settlement {
  gatewayTxnId: string;
  gatewayPayload: Prisma.InputJsonValue;
  confirmedAt: Date;
}

export interface PaymentFilter {
  organizationId?: string;
  contractId?: string;
  status?: PaymentStatus;
}

// The only class of `billing` that touches Payment (D-044 rule 4, billing task 1.1).
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async referenceExists(reference: string, client: Client = this.prisma): Promise<boolean> {
    const found = await client.payment.findUnique({ where: { reference }, select: { id: true } });
    return found !== null;
  }

  // A page of payments, newest first (api-design 14).
  page(
    filter: PaymentFilter,
    skip: number,
    take: number,
    client: Client = this.prisma,
  ): Promise<[PaymentRow[], number]> {
    const where: Prisma.PaymentWhereInput = {
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      ...(filter.contractId ? { contractId: filter.contractId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    return Promise.all([
      client.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: PAYMENT_SELECT,
      }),
      client.payment.count({ where }),
    ]);
  }

  // The payments of one invoice, oldest first (api-design 09).
  ofInvoice(invoiceId: string, client: Client = this.prisma): Promise<PaymentRow[]> {
    return client.payment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'asc' },
      select: PAYMENT_SELECT,
    });
  }

  // The confirmed payments of a contract with their invoice number, oldest first (the handover note,
  // rentals design §4.1).
  confirmedOfContract(contractId: string, client: Client = this.prisma) {
    return client.payment.findMany({
      where: { contractId, status: PaymentStatus.CONFIRMED },
      orderBy: [{ confirmedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        reference: true,
        amountVnd: true,
        method: true,
        confirmedAt: true,
        invoice: { select: { number: true } },
      },
    });
  }

  findById(id: string, client: Client = this.prisma): Promise<PaymentRow | null> {
    return client.payment.findUnique({ where: { id }, select: PAYMENT_SELECT });
  }

  // The SePay request of the invoice still waiting for its money, if any.
  // Serializes the SePay requests of one invoice for the rest of the transaction, so the check for a
  // waiting request and the insert of a new one cannot interleave (review of #92).
  async lockInvoiceRequests(invoiceId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:sepay:${invoiceId}`}))`;
  }

  // A PENDING request read after its expiry becomes EXPIRED at once (api-design 15), without
  // waiting for the minutely job. Returns the row as it now stands.
  async expireIfDue(payment: PaymentRow, at: Date): Promise<PaymentRow> {
    if (
      payment.status !== PaymentStatus.PENDING ||
      !payment.expiresAt ||
      payment.expiresAt.getTime() > at.getTime()
    ) {
      return payment;
    }
    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.EXPIRED },
    });
    return { ...payment, status: PaymentStatus.EXPIRED };
  }

  // Money that arrived for a request but was recorded as its own payment (another amount), keyed
  // `<reference>-<transaction>`, so the request's page can show it (review of #92).
  receivedFor(reference: string, client: Client = this.prisma) {
    return client.payment.findMany({
      where: {
        reference: { startsWith: `${reference}-` },
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.CONFIRMED,
      },
      orderBy: { confirmedAt: 'asc' },
      select: { amountVnd: true, confirmedAt: true },
    });
  }

  findPendingSepay(invoiceId: string, at: Date, client: Client = this.prisma) {
    return client.payment.findFirst({
      where: {
        invoiceId,
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.PENDING,
        expiresAt: { gt: at },
      },
      select: PAYMENT_SELECT,
    });
  }

  insertSepayPayment(payment: NewSepayPayment, tx: Prisma.TransactionClient): Promise<PaymentRow> {
    return tx.payment.create({
      data: {
        ...payment,
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.PENDING,
        isSandbox: true,
      },
      select: PAYMENT_SELECT,
    });
  }

  // Locks the payment of a reference for the webhook, so two deliveries of one transfer apply once.
  async lockByReference(
    reference: string,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentRow | null> {
    await tx.$queryRaw`SELECT 1 FROM "payments" WHERE "reference" = ${reference} FOR UPDATE`;
    return tx.payment.findUnique({ where: { reference }, select: PAYMENT_SELECT });
  }

  async gatewayTxnExists(gatewayTxnId: string, client: Client = this.prisma): Promise<boolean> {
    const found = await client.payment.findUnique({
      where: { gatewayTxnId },
      select: { id: true },
    });
    return found !== null;
  }

  confirmSepay(id: string, settlement: Settlement, tx: Prisma.TransactionClient) {
    return tx.payment.update({
      where: { id },
      data: { ...settlement, status: PaymentStatus.CONFIRMED },
      select: PAYMENT_SELECT,
    });
  }

  // Money that moved without matching its request (another amount, or after expiry) is recorded as
  // its own confirmed payment of what arrived (billing design §3).
  insertReceivedSepay(
    payment: Omit<NewSepayPayment, 'expiresAt' | 'requestedById'> & Settlement,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentRow> {
    return tx.payment.create({
      data: {
        ...payment,
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.CONFIRMED,
        isSandbox: true,
      },
      select: PAYMENT_SELECT,
    });
  }

  // PENDING SePay requests past their expiry become EXPIRED; nothing is settled (REQ-STA-01).
  async expireDue(at: Date, client: Client = this.prisma): Promise<number> {
    const { count } = await client.payment.updateMany({
      where: { method: PaymentMethod.SEPAY, status: PaymentStatus.PENDING, expiresAt: { lte: at } },
      data: { status: PaymentStatus.EXPIRED },
    });
    return count;
  }

  // A counter payment is confirmed when it is recorded, and moves no real sandbox money (BR-34).
  insertCounterPayment(
    payment: NewCounterPayment,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentRow> {
    return tx.payment.create({
      data: { ...payment, status: PaymentStatus.CONFIRMED, isSandbox: false },
      select: PAYMENT_SELECT,
    });
  }
}
