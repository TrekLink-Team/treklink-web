import { DeviceStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StockTakesRepository } from './stock-takes.repository';

// devices task 2.6: the Prisma calls behind the stock-take. The classification of a count is in
// stock-take-classify and stock-take.service.spec.ts; this file asserts which units are counted,
// what a stock-take row keeps and how the history pages.

const AT = new Date('2026-11-20T03:00:00.000Z');
const STOCK_TAKE_SELECT = {
  id: true,
  scannedTags: true,
  result: true,
  takenById: true,
  createdAt: true,
};

const takeRow = (extra: Record<string, unknown> = {}) => ({
  id: 'st-1',
  scannedTags: ['TL-0001'],
  result: { matched: 1 },
  takenById: 'staff-1',
  createdAt: AT,
  ...extra,
});

describe('StockTakesRepository', () => {
  let prisma: {
    device: { findMany: jest.Mock };
    stockTake: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: { device: { findMany: jest.Mock }; stockTake: { create: jest.Mock } };
  let repository: StockTakesRepository;

  beforeEach(() => {
    prisma = {
      device: { findMany: jest.fn().mockResolvedValue([]) },
      stockTake: {
        create: jest.fn(),
        findMany: jest.fn().mockReturnValue('rows-query'),
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[takeRow()], 1]),
    };
    tx = {
      device: { findMany: jest.fn().mockResolvedValue([]) },
      stockTake: { create: jest.fn().mockResolvedValue(takeRow()) },
    };
    repository = new StockTakesRepository(prisma as unknown as PrismaService);
  });

  describe('countedDevices', () => {
    it('counts every unit still on the register, RETIRED and DISPOSED left out, by asset tag', async () => {
      const units = [
        { id: 'd-1', assetTag: 'TL-0001', status: DeviceStatus.AVAILABLE, lastSeenAt: AT },
      ];
      prisma.device.findMany.mockResolvedValue(units);
      await expect(repository.countedDevices()).resolves.toBe(units);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { status: { notIn: [DeviceStatus.RETIRED, DeviceStatus.DISPOSED] } },
        select: { id: true, assetTag: true, status: true, lastSeenAt: true },
        orderBy: { assetTag: 'asc' },
      });
    });

    it('reads through the transaction client when one is given', async () => {
      await repository.countedDevices(tx as never);
      expect(tx.device.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.device.findMany).not.toHaveBeenCalled();
    });
  });

  describe('insert', () => {
    it('keeps the scanned tags, the result, who took it and when, through the transaction', async () => {
      const data = {
        scannedTags: ['TL-0001', 'TL-0002'],
        result: { matched: 1, unknown: ['TL-0002'] },
        takenById: 'staff-1',
        createdAt: AT,
      };
      await expect(repository.insert(data, tx as never)).resolves.toEqual(takeRow());
      expect(tx.stockTake.create).toHaveBeenCalledWith({ data, select: STOCK_TAKE_SELECT });
      expect(prisma.stockTake.create).not.toHaveBeenCalled();
    });
  });

  describe('page', () => {
    it('reads one page newest first and the total in a single transaction', async () => {
      await expect(repository.page(20, 10)).resolves.toEqual([[takeRow()], 1]);
      expect(prisma.stockTake.findMany).toHaveBeenCalledWith({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 20,
        take: 10,
        select: STOCK_TAKE_SELECT,
      });
      expect(prisma.stockTake.count).toHaveBeenCalledWith();
      expect(prisma.$transaction).toHaveBeenCalledWith(['rows-query', 'count-query']);
    });
  });
});
