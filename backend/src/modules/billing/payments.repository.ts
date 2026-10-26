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
