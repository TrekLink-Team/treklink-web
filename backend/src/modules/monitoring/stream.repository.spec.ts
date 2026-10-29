import { PrismaService } from '../../common/prisma/prisma.service';
import { StreamRepository } from './stream.repository';

const row = (seq: bigint, organizationId: string | null = 'o-1') => ({
  seq,
  organizationId,
  type: 'device.position',
  deviceId: 'd-1',
  payload: { lat: 11.5 },
  createdAt: new Date('2026-10-25T03:00:00.000Z'),
});

describe('StreamRepository', () => {
  let streamEvent: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    aggregate: jest.Mock;
  };
  let deviceRelease: { findUnique: jest.Mock };
  let executeRaw: jest.Mock;
  let repository: StreamRepository;

  beforeEach(() => {
    streamEvent = {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
    };
    deviceRelease = { findUnique: jest.fn() };
    executeRaw = jest.fn().mockResolvedValue(1);
    repository = new StreamRepository({
      streamEvent,
      deviceRelease,
      $executeRaw: executeRaw,
    } as unknown as PrismaService);
  });

  it('inserts an entry and returns the cursor as a number with an ISO time', async () => {
    streamEvent.create.mockResolvedValue(row(88_214n));
    await expect(
      repository.insert({ organizationId: 'o-1', type: 'device.position', payload: { lat: 11.5 } }),
    ).resolves.toEqual({
      seq: 88_214,
      organizationId: 'o-1',
      type: 'device.position',
      deviceId: 'd-1',
      payload: { lat: 11.5 },
      createdAt: '2026-10-25T03:00:00.000Z',
    });
    expect(streamEvent.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'o-1',
        type: 'device.position',
        deviceId: null,
        payload: { lat: 11.5 },
      },
    });
  });

  it('stores a platform-wide entry with no organization', async () => {
    streamEvent.create.mockResolvedValue(row(1n, null));
    await repository.insert({ organizationId: null, type: 'station.stale', payload: {} });
    expect(streamEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: null }) as unknown,
    });
  });

  it('reads an organization its own entries after the cursor, oldest first', async () => {
    streamEvent.findMany.mockResolvedValue([row(11n), row(12n)]);
    const entries = await repository.after('o-1', 10, 500);
    expect(entries.map((e) => e.seq)).toEqual([11, 12]);
    expect(streamEvent.findMany).toHaveBeenCalledWith({
      where: { seq: { gt: 10n }, organizationId: 'o-1' },
      orderBy: { seq: 'asc' },
      take: 500,
    });
  });

  it('reads the fleet every entry after the cursor', async () => {
    streamEvent.findMany.mockResolvedValue([]);
    await repository.after(null, 10, 500);
    expect(streamEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seq: { gt: 10n } } }) as unknown,
    );
  });

  it('records a check-in, keeping the later one when recorded twice or out of order', async () => {
    const checkedInAt = new Date('2026-10-25T03:00:00.000Z');
    await repository.recordRelease('o-1', 'd-1', checkedInAt);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('INSERT INTO "device_releases"');
    expect(strings.join('?')).toContain(
      'GREATEST("device_releases"."checkedInAt", EXCLUDED."checkedInAt")',
    );
    expect(values).toEqual(['o-1', 'd-1', checkedInAt]);
  });

  it("reads an organization's latest check-in of a device from its own table", async () => {
    const checkedInAt = new Date('2026-10-25T03:00:00.000Z');
    deviceRelease.findUnique.mockResolvedValue({ checkedInAt });
    await expect(repository.latestRelease('o-1', 'd-1')).resolves.toEqual(checkedInAt);
    expect(deviceRelease.findUnique).toHaveBeenCalledWith({
      where: { organizationId_deviceId: { organizationId: 'o-1', deviceId: 'd-1' } },
      select: { checkedInAt: true },
    });
  });

  it('reads no check-in for a device the organization never checked in', async () => {
    deviceRelease.findUnique.mockResolvedValue(null);
    await expect(repository.latestRelease('o-1', 'd-1')).resolves.toBeNull();
  });

  it('reads the oldest cursor inside the retention window, or null when none is that recent', async () => {
    const cutoff = new Date('2026-10-27T03:00:00.000Z');
    streamEvent.findFirst.mockResolvedValueOnce({ seq: 412n });
    await expect(repository.oldestSeqSince(cutoff)).resolves.toBe(412);
    expect(streamEvent.findFirst).toHaveBeenCalledWith({
      where: { createdAt: { gte: cutoff } },
      orderBy: { seq: 'asc' },
      select: { seq: true },
    });
    streamEvent.findFirst.mockResolvedValueOnce(null);
    await expect(repository.oldestSeqSince(cutoff)).resolves.toBeNull();
  });

  it('deletes a batch of entries older than the cutoff, oldest first, and reports how many went', async () => {
    executeRaw.mockResolvedValue(42);
    const cutoff = new Date('2026-10-27T03:00:00.000Z');
    await expect(repository.pruneBefore(cutoff, 5000)).resolves.toBe(42);
    const [strings, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain('DELETE FROM "stream_events"');
    expect(sql).toContain('ORDER BY "seq"');
    expect(sql).not.toContain('device_releases');
    expect(values).toEqual([cutoff, 5000]);
  });

  it('reads the newest cursor, or 0 for an empty stream', async () => {
    streamEvent.aggregate.mockResolvedValueOnce({ _max: { seq: 90n } });
    await expect(repository.maxSeq()).resolves.toBe(90);
    streamEvent.aggregate.mockResolvedValueOnce({ _max: { seq: null } });
    await expect(repository.maxSeq()).resolves.toBe(0);
  });
});
