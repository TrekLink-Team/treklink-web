import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PAYMENT_SELECT, PaymentRow, PaymentsRepository } from './payments.repository';

const AT = new Date('2026-11-02T03:00:00Z');
const PAYMENT: PaymentRow = {
  id: 'p-1',
  reference: 'TL7K2Q9M4D',
  invoiceId: 'i-1',
  contractId: 'c-1',
  organizationId: 'o-1',
  amountVnd: 100n,
  method: PaymentMethod.SEPAY,
  status: PaymentStatus.PENDING,
  isSandbox: true,
  expiresAt: AT,
  confirmedAt: null,
};

describe('Payment persistence lifecycle coverage', () => {
  const payment = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const db = { payment, $executeRaw: jest.fn(), $queryRaw: jest.fn() };
  const tx = db as unknown as Prisma.TransactionClient;
  const repository = new PaymentsRepository(db as unknown as PrismaService);
  beforeEach(() => {
    jest.resetAllMocks();
    payment.findMany.mockResolvedValue([PAYMENT]);
    payment.count.mockResolvedValue(1);
    payment.updateMany.mockResolvedValue({ count: 2 });
    payment.findUnique.mockResolvedValue(PAYMENT);
    payment.create.mockResolvedValue(PAYMENT);
    payment.update.mockResolvedValue(PAYMENT);
  });

  it.each([{}, { organizationId: 'o-1', contractId: 'c-1', status: PaymentStatus.PENDING }])(
    'paginates using only supplied filters %j',
    async (filter) => {
      await expect(repository.page(filter, 4, 2)).resolves.toEqual([[PAYMENT], 1]);
      expect(payment.findMany).toHaveBeenCalledWith({
        where: filter,
        skip: 4,
        take: 2,
        orderBy: { createdAt: 'desc' },
        select: PAYMENT_SELECT,
      });
      expect(payment.count).toHaveBeenCalledWith({ where: filter });
      await repository.page(filter, 0, 5, tx);
    },
  );
  it('reads invoice payments and one payment with the selected columns', async () => {
    await expect(repository.ofInvoice('i-1')).resolves.toEqual([PAYMENT]);
    expect(payment.findMany).toHaveBeenCalledWith({
      where: { invoiceId: 'i-1' },
      orderBy: { createdAt: 'asc' },
      select: PAYMENT_SELECT,
    });
    await expect(repository.findById('p-1')).resolves.toBe(PAYMENT);
    expect(payment.findUnique).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      select: PAYMENT_SELECT,
    });
    await repository.ofInvoice('i-1', tx);
    await repository.findById('p-1', tx);
  });
  it.each([
    { status: PaymentStatus.CONFIRMED },
    { expiresAt: null },
    { expiresAt: new Date(AT.getTime() + 1) },
  ])('leaves an ineligible expiry unchanged: %j', async (change) => {
    const row = { ...PAYMENT, ...change };
    await expect(repository.expireIfDue(row, AT)).resolves.toBe(row);
    expect(payment.updateMany).not.toHaveBeenCalled();
  });
  it('expires at the exact deadline using a pending-only update', async () => {
    await expect(repository.expireIfDue(PAYMENT, AT)).resolves.toEqual({
      ...PAYMENT,
      status: PaymentStatus.EXPIRED,
    });
    expect(payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.EXPIRED },
    });
    expect(PAYMENT.status).toBe(PaymentStatus.PENDING);
  });
  it('locks requests by invoice and locks a reference before reading it', async () => {
    await repository.lockInvoiceRequests('i-1', tx);
    const [sql, key] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('pg_advisory_xact_lock');
    expect(key).toBe('billing:sepay:i-1');
    await expect(repository.lockByReference(PAYMENT.reference, tx)).resolves.toBe(PAYMENT);
    const [lock, reference] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(lock.join('?')).toContain('FOR UPDATE');
    expect(reference).toBe(PAYMENT.reference);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      payment.findUnique.mock.invocationCallOrder[0],
    );
    expect(payment.findUnique).toHaveBeenCalledWith({
      where: { reference: PAYMENT.reference },
      select: PAYMENT_SELECT,
    });
  });
  it('looks up a live pending request and received money separately', async () => {
    payment.findFirst.mockResolvedValue(PAYMENT);
    await expect(repository.findPendingSepay('i-1', AT)).resolves.toBe(PAYMENT);
    expect(payment.findFirst).toHaveBeenCalledWith({
      where: {
        invoiceId: 'i-1',
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.PENDING,
        expiresAt: { gt: AT },
      },
      select: PAYMENT_SELECT,
    });
    await repository.receivedFor(PAYMENT.reference);
    expect(payment.findMany).toHaveBeenCalledWith({
      where: {
        reference: { startsWith: 'TL7K2Q9M4D-' },
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.CONFIRMED,
      },
      orderBy: { confirmedAt: 'asc' },
      select: { amountVnd: true, confirmedAt: true },
    });
    await repository.findPendingSepay('i-1', AT, tx);
    await repository.receivedFor(PAYMENT.reference, tx);
  });
  it('persists the intent as pending and later records the gateway settlement', async () => {
    const intent = {
      reference: PAYMENT.reference,
      organizationId: 'o-1',
      contractId: 'c-1',
      invoiceId: 'i-1',
      amountVnd: 100n,
      requestedById: 'u-1',
      expiresAt: AT,
    };
    await expect(repository.insertSepayPayment(intent, tx)).resolves.toBe(PAYMENT);
    expect(payment.create).toHaveBeenCalledWith({
      data: {
        ...intent,
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.PENDING,
        isSandbox: true,
      },
      select: PAYMENT_SELECT,
    });
    const settlement = { gatewayTxnId: '42', gatewayPayload: { id: 42 }, confirmedAt: AT };
    await repository.confirmSepay('p-1', settlement, tx);
    expect(payment.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { ...settlement, status: PaymentStatus.CONFIRMED },
      select: PAYMENT_SELECT,
    });
    const received = {
      reference: 'TL7K2Q9M4D-42',
      organizationId: 'o-1',
      contractId: 'c-1',
      invoiceId: 'i-1',
      amountVnd: 80n,
      ...settlement,
    };
    await repository.insertReceivedSepay(received, tx);
    expect(payment.create).toHaveBeenLastCalledWith({
      data: {
        ...received,
        method: PaymentMethod.SEPAY,
        status: PaymentStatus.CONFIRMED,
        isSandbox: true,
      },
      select: PAYMENT_SELECT,
    });
  });
  it('deduplicates only recorded gateway transactions', async () => {
    payment.findUnique.mockResolvedValueOnce(null);
    await expect(repository.gatewayTxnExists('42')).resolves.toBe(false);
    await expect(repository.gatewayTxnExists('42', tx)).resolves.toBe(true);
    expect(payment.findUnique).toHaveBeenCalledWith({
      where: { gatewayTxnId: '42' },
      select: { id: true },
    });
  });
  it('expires only overdue pending SePay requests and returns the affected count', async () => {
    await expect(repository.expireDue(AT)).resolves.toBe(2);
    expect(payment.updateMany).toHaveBeenCalledWith({
      where: { method: PaymentMethod.SEPAY, status: PaymentStatus.PENDING, expiresAt: { lte: AT } },
      data: { status: PaymentStatus.EXPIRED },
    });
    await repository.expireDue(AT, tx);
  });
});
