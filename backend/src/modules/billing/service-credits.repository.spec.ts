import { Prisma, ServiceCreditStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  NewServiceCredit,
  SERVICE_CREDIT_SELECT,
  ServiceCreditsRepository,
} from './service-credits.repository';
const AT = new Date('2026-11-01T00:00:00Z');

describe('Service credit persistence coverage', () => {
  const serviceCredit = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const db = {
    serviceCredit,
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  const tx = db as unknown as Prisma.TransactionClient;
  const repository = new ServiceCreditsRepository(db as unknown as PrismaService);
  beforeEach(() => {
    jest.clearAllMocks();
    serviceCredit.findUnique.mockResolvedValue({ id: 'sc-1' });
    serviceCredit.findMany.mockResolvedValue([{ id: 'sc-1' }]);
    serviceCredit.count.mockResolvedValue(1);
    serviceCredit.create.mockResolvedValue({ id: 'sc-1' });
    serviceCredit.update.mockResolvedValue({ id: 'sc-1', version: 2 });
  });
  it('serializes requests per unit and excludes rejected and non-overlapping outages', async () => {
    await repository.lockUnit('cd-1', tx);
    const [sql, key] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('pg_advisory_xact_lock');
    expect(key).toBe('billing:credit:cd-1');
    const to = new Date(AT.getTime() + 86400000);
    await repository.overlapping('cd-1', AT, to, tx);
    expect(serviceCredit.findFirst).toHaveBeenCalledWith({
      where: {
        contractDeviceId: 'cd-1',
        status: { not: ServiceCreditStatus.REJECTED },
        outageFrom: { lt: to },
        outageTo: { gt: AT },
      },
      select: { id: true },
    });
  });
  it('inserts requested fault and release credits with distinct kinds', async () => {
    const release = {
      contractId: 'c-1',
      organizationId: 'o-1',
      contractDeviceId: 'cd-1',
      deviceId: 'd-1',
      unitReleaseId: 'r-1',
      computedVnd: 100n,
      requestedById: 'u-1',
    };
    await expect(repository.insertRelease(release, tx)).resolves.toEqual({ id: 'sc-1' });
    expect(serviceCredit.create).toHaveBeenCalledWith({
      data: { ...release, kind: 'RELEASE', status: 'REQUESTED' },
      select: SERVICE_CREDIT_SELECT,
    });
    const fault: NewServiceCredit = {
      contractId: 'c-1',
      organizationId: 'o-1',
      contractDeviceId: 'cd-1',
      deviceId: 'd-1',
      computedVnd: 100n,
      requestedById: 'u-1',
      cause: 'BATTERY_FAULT',
      faultInspectionId: 'f-1',
      outageFrom: AT,
      outageTo: AT,
      outageDays: 1,
      outageSourceIncidentId: null,
      outageSourceFaultReportId: null,
      outageSourceNote: 'reported',
    };
    await repository.insert(fault, tx);
    expect(serviceCredit.create).toHaveBeenLastCalledWith({
      data: { ...fault, status: 'REQUESTED' },
      select: SERVICE_CREDIT_SELECT,
    });
  });
  it('locks before reading and increments the decision version', async () => {
    await expect(repository.lock('sc-1', tx)).resolves.toEqual({ id: 'sc-1' });
    const [sql, id] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(id).toBe('sc-1');
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      serviceCredit.findUnique.mock.invocationCallOrder[0],
    );
    expect(serviceCredit.findUnique).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      select: SERVICE_CREDIT_SELECT,
    });
    await expect(repository.update('sc-1', { status: 'REFUNDED' }, tx)).resolves.toEqual({
      id: 'sc-1',
      version: 2,
    });
    expect(serviceCredit.update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { status: 'REFUNDED', version: { increment: 1 } },
      select: SERVICE_CREDIT_SELECT,
    });
  });
  it('locks approved credits and returns them oldest decision first', async () => {
    await repository.approvedWithRemainder('c-1', tx);
    const [sql, id] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(sql.join('?')).toContain("'APPROVED'");
    expect(id).toBe('c-1');
    expect(serviceCredit.findMany).toHaveBeenCalledWith({
      where: { contractId: 'c-1', status: 'APPROVED' },
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
      select: SERVICE_CREDIT_SELECT,
    });
  });
  it('reads close blockers and credit details with or without a supplied transaction', async () => {
    await repository.requestedOfContract('c-1');
    await repository.requestedOfContract('c-1', tx);
    expect(serviceCredit.findMany).toHaveBeenCalledWith({
      where: { contractId: 'c-1', status: 'REQUESTED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, deviceId: true, computedVnd: true },
    });
    await repository.find('sc-1');
    await repository.find('sc-1', tx);
    expect(serviceCredit.findUnique).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      select: SERVICE_CREDIT_SELECT,
    });
    await repository.refundReferenceUsed('BANK-42', tx);
    expect(serviceCredit.findUnique).toHaveBeenLastCalledWith({
      where: { refundReference: 'BANK-42' },
      select: { id: true },
    });
  });
  it('applies organization, contract and status filters to both page and count', async () => {
    const filter = {
      organizationId: 'o-1',
      contractId: 'c-1',
      status: ServiceCreditStatus.REFUND_DUE,
    };
    await expect(repository.page(filter, 10, 5)).resolves.toEqual([[{ id: 'sc-1' }], 1]);
    expect(serviceCredit.findMany).toHaveBeenCalledWith({
      where: filter,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 10,
      take: 5,
      select: SERVICE_CREDIT_SELECT,
    });
    expect(serviceCredit.count).toHaveBeenCalledWith({ where: filter });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
