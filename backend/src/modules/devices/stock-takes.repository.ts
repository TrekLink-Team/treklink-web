import { Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export interface CountedDevice {
  id: string;
  assetTag: string;
  status: DeviceStatus;
  lastSeenAt: Date | null;
}

const STOCK_TAKE_SELECT = {
  id: true,
  scannedTags: true,
  result: true,
  takenById: true,
  createdAt: true,
} satisfies Prisma.StockTakeSelect;

export type StockTakeRow = Prisma.StockTakeGetPayload<{ select: typeof STOCK_TAKE_SELECT }>;

// The `stock_takes` rows and the device read a count compares against (devices task 2.6).
@Injectable()
export class StockTakesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Every unit the register still holds: RETIRED and DISPOSED units are out of the count.
  countedDevices(client: Client = this.prisma): Promise<CountedDevice[]> {
    return client.device.findMany({
      where: { status: { notIn: [DeviceStatus.RETIRED, DeviceStatus.DISPOSED] } },
      select: { id: true, assetTag: true, status: true, lastSeenAt: true },
      orderBy: { assetTag: 'asc' },
    });
  }

  insert(
    data: {
      scannedTags: string[];
      result: Prisma.InputJsonValue;
      takenById: string;
      createdAt: Date;
    },
    tx: Prisma.TransactionClient,
  ): Promise<StockTakeRow> {
    return tx.stockTake.create({ data, select: STOCK_TAKE_SELECT });
  }

  async page(skip: number, take: number): Promise<[StockTakeRow[], number]> {
    return this.prisma.$transaction([
      this.prisma.stockTake.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: STOCK_TAKE_SELECT,
      }),
      this.prisma.stockTake.count(),
    ]);
  }
}
