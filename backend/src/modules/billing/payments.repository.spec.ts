import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PAYMENT_SELECT, PaymentsRepository } from './payments.repository';

const AT = new Date('2026-10-26T03:00:00.000Z');

describe('PaymentsRepository (billing tasks 1.1 and 3.1)', () => {
  let prisma: { payment: Record<string, jest.Mock> };
  let repository: PaymentsRepository;

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'p-1' }),
      },
    };
    repository = new PaymentsRepository(prisma as unknown as PrismaService);
  });

  it('tells whether a reference is already recorded', async () => {
    await expect(repository.referenceExists('RCPT-1')).resolves.toBe(false);
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'p-0' });
    await expect(repository.referenceExists('RCPT-1')).resolves.toBe(true);
    expect(prisma.payment.findUnique).toHaveBeenCalledWith({
      where: { reference: 'RCPT-1' },
      select: { id: true },
    });
  });

  it('inserts a counter payment confirmed and outside the sandbox (BR-34)', async () => {
    const payment = {
      reference: 'RCPT-1',
      organizationId: 'org-1',
      contractId: 'c-1',
      invoiceId: 'inv-1',
      amountVnd: 100n,
      method: PaymentMethod.BANK_TRANSFER,
      recordedById: 'staff-1',
      confirmedAt: AT,
    };
    await repository.insertCounterPayment(payment, prisma as unknown as Prisma.TransactionClient);

    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: { ...payment, status: PaymentStatus.CONFIRMED, isSandbox: false },
      select: PAYMENT_SELECT,
    });
  });
});
