import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IngestionRepository } from './ingestion.repository';

describe('IngestionRepository.plottedPositionTimes (incidents REQ-EVT-02)', () => {
  it('reads the plotted positions of the device in the closed range, oldest first', async () => {
    const from = new Date('2026-10-29T03:00:00Z');
    const to = new Date('2026-10-29T03:02:00Z');
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { occurredAt: new Date('2026-10-29T03:00:00Z') },
        { occurredAt: new Date('2026-10-29T03:01:00Z') },
      ]);
    const repository = new IngestionRepository({} as PrismaService);
    await expect(
      repository.plottedPositionTimes('dev-1', from, to, {
        fieldEvent: { findMany },
      } as unknown as Prisma.TransactionClient),
    ).resolves.toEqual([new Date('2026-10-29T03:00:00Z'), new Date('2026-10-29T03:01:00Z')]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        deviceId: 'dev-1',
        kind: 'POSITION',
        plotted: true,
        latitude: { not: null },
        occurredAt: { gte: from, lte: to },
      },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    });
  });
});
