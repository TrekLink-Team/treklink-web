import { SyncOutcome } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FIELD_EVENT_ROW, SYNC_AUDIT_ROW, SyncQueryRepository } from './sync-query.repository';

describe('SyncQueryRepository', () => {
  const prisma = {
    fieldEvent: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    syncAuditLog: { groupBy: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  };
  const repository = new SyncQueryRepository(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('pages field events by seq with the row selection and counts the filter', async () => {
    prisma.fieldEvent.findMany.mockResolvedValue([{ seq: 1n }]);
    prisma.fieldEvent.count.mockResolvedValue(1);
    await expect(repository.pageEvents({ deviceId: 'd-1' }, 'desc', 20, 10)).resolves.toEqual([
      [{ seq: 1n }],
      1,
    ]);
    expect(prisma.fieldEvent.findMany).toHaveBeenCalledWith({
      where: { deviceId: 'd-1' },
      orderBy: { seq: 'desc' },
      skip: 20,
      take: 10,
      select: FIELD_EVENT_ROW,
    });
    expect(prisma.fieldEvent.count).toHaveBeenCalledWith({ where: { deviceId: 'd-1' } });
  });

  it('pages sync audit rows newest first, id breaking a tie, and counts the filter', async () => {
    prisma.syncAuditLog.findMany.mockResolvedValue([{ id: 'sa-1' }]);
    prisma.syncAuditLog.count.mockResolvedValue(7);
    const where = { outcome: { in: [SyncOutcome.MALFORMED_ENVELOPE] } };
    await expect(repository.pageAudit(where, 0, 20)).resolves.toEqual([[{ id: 'sa-1' }], 7]);
    expect(prisma.syncAuditLog.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
      select: SYNC_AUDIT_ROW,
    });
    expect(prisma.syncAuditLog.count).toHaveBeenCalledWith({ where });
  });

  it('counts audit outcomes since a time', async () => {
    const since = new Date('2026-11-01T02:00:00Z');
    prisma.syncAuditLog.groupBy.mockResolvedValue([
      { outcome: SyncOutcome.ACCEPTED, _count: { _all: 4 } },
    ]);
    const counts = await repository.outcomesSince(since);
    expect(counts.get(SyncOutcome.ACCEPTED)).toBe(4);
    expect(prisma.syncAuditLog.groupBy).toHaveBeenCalledWith({
      by: ['outcome'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
  });

  it('reads the receipt time of the latest event, null on an empty ledger', async () => {
    const at = new Date('2026-11-01T03:00:00Z');
    prisma.fieldEvent.findFirst
      .mockResolvedValueOnce({ receivedAt: at })
      .mockResolvedValueOnce(null);
    await expect(repository.lastReceivedAt()).resolves.toEqual(at);
    await expect(repository.lastReceivedAt()).resolves.toBeNull();
  });
});
