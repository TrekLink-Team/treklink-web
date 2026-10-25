import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  codeYear,
  CONTRACT_SELECT,
  ContractsRepository,
  CUSTODY_SELECT,
  NewContract,
} from './contracts.repository';

const AT = new Date('2026-10-25T02:00:00.000Z');

const NEW: NewContract = {
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v3',
  quantity: 5,
  requestedStartDate: new Date('2026-11-01T00:00:00.000Z'),
  monthlyUnitPriceVnd: 250_000n,
  dayPremium: null,
  holdingFeeRatio: new Prisma.Decimal('0.5'),
  requestedById: 'manager-1',
};

const ROW = {
  id: 'c-1',
  code: 'RC-2026-0001',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  quantity: 5,
  status: ContractStatus.REQUESTED,
  version: 0,
};

describe('codeYear', () => {
  it('counts by the calendar year in UTC+7', () => {
    expect(codeYear(new Date('2026-12-31T16:59:59.000Z'))).toBe(2026);
    expect(codeYear(new Date('2026-12-31T17:00:00.000Z'))).toBe(2027);
  });
});

describe('ContractsRepository', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    rentalContract: Record<string, jest.Mock>;
    contractTransition: { create: jest.Mock };
    contractDevice: Record<string, jest.Mock>;
  };
  let repository: ContractsRepository;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      rentalContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(ROW),
        findUnique: jest.fn().mockResolvedValue(ROW),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(2),
      },
      contractTransition: { create: jest.fn().mockResolvedValue(undefined) },
      contractDevice: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    repository = new ContractsRepository(tx as unknown as PrismaService);
  });

  const client = () => tx as unknown as Prisma.TransactionClient;

  describe('insertRequested (task 1.1)', () => {
    it('allocates RC-<year>-0001 under the year lock and writes the first transition', async () => {
      await expect(repository.insertRequested(NEW, AT, client())).resolves.toBe(ROW);

      const [sql, key] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, string];
      expect(sql.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))');
      expect(key).toBe('rentals:code:2026');
      expect(tx.rentalContract.findFirst).toHaveBeenCalledWith({
        where: { code: { startsWith: 'RC-2026-' } },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
      expect(tx.rentalContract.create).toHaveBeenCalledWith({
        data: {
          ...NEW,
          code: 'RC-2026-0001',
          status: ContractStatus.REQUESTED,
          statusChangedAt: AT,
        },
        select: CONTRACT_SELECT,
      });
      expect(tx.contractTransition.create).toHaveBeenCalledWith({
        data: {
          contractId: 'c-1',
          fromStatus: null,
          toStatus: ContractStatus.REQUESTED,
          actorId: 'manager-1',
          createdAt: AT,
        },
      });
    });

    it('continues the year sequence, and refuses past 9999', async () => {
      tx.rentalContract.findFirst.mockResolvedValueOnce({ code: 'RC-2026-0041' });
      await repository.insertRequested(NEW, AT, client());
      expect(tx.rentalContract.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'RC-2026-0042' }) as object,
        }),
      );

      tx.rentalContract.findFirst.mockResolvedValueOnce({ code: 'RC-2026-9999' });
      await expect(repository.insertRequested(NEW, AT, client())).rejects.toThrow(
        'Contract code range exhausted for 2026.',
      );
    });
  });

  it('locks a contract row FOR UPDATE, and answers 404 for an unknown one', async () => {
    await expect(repository.lockById('c-1', client())).resolves.toBe(ROW);
    const [sql, id] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toBe('SELECT 1 FROM "rental_contracts" WHERE "id" = ? FOR UPDATE');
    expect(id).toBe('c-1');

    tx.rentalContract.findUnique.mockResolvedValue(null);
    await expect(repository.lockById('c-x', client())).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
      message: 'Contract not found.',
    });
  });

  it('inserts the committed devices in one statement', async () => {
    const rows = [
      { contractId: 'c-1', deviceId: 'd-1' },
      { contractId: 'c-1', deviceId: 'd-2' },
    ];
    await repository.insertContractDevices(rows, client());
    expect(tx.contractDevice.createMany).toHaveBeenCalledWith({ data: rows });
  });

  describe('transition (task 1.2)', () => {
    const change = {
      from: ContractStatus.REQUESTED,
      to: ContractStatus.APPROVED,
      version: 0,
      actorId: 'staff-1',
      reason: null,
      at: AT,
    };

    it('compare-and-sets status and version, then appends one transition row', async () => {
      await expect(repository.transition('c-1', change, client())).resolves.toBe(true);

      expect(tx.rentalContract.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: ContractStatus.REQUESTED, version: 0 },
        data: { status: ContractStatus.APPROVED, statusChangedAt: AT, version: { increment: 1 } },
      });
      expect(tx.contractTransition.create).toHaveBeenCalledWith({
        data: {
          contractId: 'c-1',
          fromStatus: ContractStatus.REQUESTED,
          toStatus: ContractStatus.APPROVED,
          actorId: 'staff-1',
          reason: null,
          createdAt: AT,
        },
      });
    });

    it('writes nothing more when another change won the row', async () => {
      tx.rentalContract.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.transition('c-1', change, client())).resolves.toBe(false);
      expect(tx.contractTransition.create).not.toHaveBeenCalled();
    });
  });

  it('finds the custody interval containing a time, newest handover first (D-040)', async () => {
    await repository.findCustody('d-1', AT);
    expect(tx.contractDevice.findFirst).toHaveBeenCalledWith({
      where: {
        deviceId: 'd-1',
        handedOverAt: { lte: AT },
        AND: [
          { OR: [{ checkedInAt: null }, { checkedInAt: { gt: AT } }] },
          { OR: [{ lostAt: null }, { lostAt: { gt: AT } }] },
        ],
      },
      orderBy: { handedOverAt: 'desc' },
      select: CUSTODY_SELECT,
    });
  });

  it('counts the contracts that are not finished, and sets lostAt in the caller transaction', async () => {
    await expect(repository.countUnfinishedContracts('org-1')).resolves.toBe(2);
    expect(tx.rentalContract.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        status: {
          notIn: [ContractStatus.REJECTED, ContractStatus.CANCELLED, ContractStatus.CLOSED],
        },
      },
    });

    await repository.setLostAt('cd-1', AT, client());
    expect(tx.contractDevice.updateMany).toHaveBeenCalledWith({
      where: { id: 'cd-1', checkedInAt: null, lostAt: null },
      data: { lostAt: AT },
    });
  });

  it('refuses to set lostAt on a custody interval that is already closed', async () => {
    tx.contractDevice.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.setLostAt('cd-1', AT, client())).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'The custody interval is already closed.',
    });
  });
});
