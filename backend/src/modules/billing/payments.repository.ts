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

// The only class of `billing` that touches Payment (D-044 rule 4, billing task 1.1).
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async referenceExists(reference: string, client: Client = this.prisma): Promise<boolean> {
    const found = await client.payment.findUnique({ where: { reference }, select: { id: true } });
    return found !== null;
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
