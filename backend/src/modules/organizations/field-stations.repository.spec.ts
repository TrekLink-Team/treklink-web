import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldStationsRepository, STATION_VIEW } from './field-stations.repository';

const AT = new Date('2026-10-30T03:00:00.000Z');

describe('FieldStationsRepository (organizations 2.8)', () => {
  let station: Record<string, jest.Mock>;
  let client: Prisma.TransactionClient;
  let repository: FieldStationsRepository;

  beforeEach(() => {
    station = {
      findMany: jest.fn().mockResolvedValue([{ id: 'fs-1' }]),
      count: jest.fn().mockResolvedValue(3),
      create: jest.fn().mockResolvedValue({ id: 'fs-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'fs-1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'fs-1', secretHash: 'h' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({ id: 'fs-1' }),
    };
    client = { fieldStation: station } as unknown as Prisma.TransactionClient;
    repository = new FieldStationsRepository({ fieldStation: station } as unknown as PrismaService);
  });

  it('lists the stations of one organization, newest first, revoked ones included', async () => {
    await expect(repository.list('org-1')).resolves.toEqual([{ id: 'fs-1' }]);
    expect(station.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: STATION_VIEW,
    });
    expect(STATION_VIEW).not.toHaveProperty('secretHash');
  });

  it('counts the stations that are not revoked', async () => {
    await expect(repository.countActive('org-1', client)).resolves.toBe(3);
    expect(station.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', revokedAt: null },
    });
    await repository.countActive('org-1');
    expect(station.count).toHaveBeenCalledTimes(2);
  });

  it('numbers the next username one above the highest used, revoked ones included', async () => {
    station.findMany.mockResolvedValue([
      { mqttUsername: 'fs-org-0007-1' },
      { mqttUsername: 'fs-org-0007-4' },
      { mqttUsername: 'fs-org-0007-2' },
    ]);
    await expect(repository.nextNumber('org-1', client)).resolves.toBe(5);
    expect(station.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      select: { mqttUsername: true },
    });

    station.findMany.mockResolvedValue([]);
    await expect(repository.nextNumber('org-1')).resolves.toBe(1);

    station.findMany.mockResolvedValue([{ mqttUsername: 'legacy-name' }]);
    await expect(repository.nextNumber('org-1')).resolves.toBe(1);
  });

  it('inserts a station with its secret hash in the caller transaction', async () => {
    const row = {
      organizationId: 'org-1',
      name: 'Ta Nang laptop',
      mqttUsername: 'fs-org-0007-1',
      secretHash: 'h',
      createdById: 'u-1',
    };
    await repository.insert(row, client);
    expect(station.create).toHaveBeenCalledWith({ data: row, select: STATION_VIEW });
    await repository.insert(row);
    expect(station.create).toHaveBeenCalledTimes(2);
  });

  it('finds a station inside one organization only', async () => {
    await repository.find('org-1', 'fs-1');
    expect(station.findFirst).toHaveBeenCalledWith({
      where: { id: 'fs-1', organizationId: 'org-1' },
      select: STATION_VIEW,
    });
  });

  it('revokes once: the station back when it changed, null when it was already revoked', async () => {
    await expect(repository.revoke('org-1', 'fs-1', 'u-1', AT, client)).resolves.toEqual({
      id: 'fs-1',
    });
    expect(station.updateMany).toHaveBeenCalledWith({
      where: { id: 'fs-1', organizationId: 'org-1', revokedAt: null },
      data: { revokedAt: AT, revokedById: 'u-1' },
    });

    station.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.revoke('org-1', 'fs-1', 'u-1', AT)).resolves.toBeNull();
  });

  it('gives gateway-sync the credential behind a username, with its hash', async () => {
    await expect(repository.findByUsername('fs-org-0007-1')).resolves.toEqual({
      id: 'fs-1',
      secretHash: 'h',
    });
    expect(station.findUnique).toHaveBeenCalledWith({
      where: { mqttUsername: 'fs-org-0007-1' },
      select: {
        id: true,
        organizationId: true,
        mqttUsername: true,
        secretHash: true,
        revokedAt: true,
      },
    });
  });

  it('writes the health report of a station', async () => {
    const health = {
      queueDepth: [0, 1, 2, 3] as const,
      oldestRetryCount: 2,
      version: '1.2.0',
      at: AT,
    };
    await repository.updateHealth('fs-1', health, client);
    expect(station.update).toHaveBeenCalledWith({
      where: { id: 'fs-1' },
      data: {
        lastSyncAt: AT,
        queueDepth: [0, 1, 2, 3],
        oldestRetryCount: 2,
        version: '1.2.0',
      },
    });
    await repository.updateHealth('fs-1', health);
    expect(station.update).toHaveBeenCalledTimes(2);
  });

  it('writes the last flush only when the report carries one (MF-02 sync status)', async () => {
    const flushed = new Date('2026-10-30T02:59:30.000Z');
    const base = {
      queueDepth: [0, 0, 2, 9] as const,
      oldestRetryCount: 0,
      version: '0.1.0',
      at: AT,
    };
    const dataOf = (call: number) =>
      (station.update.mock.calls[call] as [{ data: Record<string, unknown> }])[0].data;
    await repository.updateHealth('fs-1', { ...base, lastFlushAt: flushed }, client);
    await repository.updateHealth('fs-1', { ...base, lastFlushAt: null }, client);
    await repository.updateHealth('fs-1', base, client);
    expect(dataOf(0)).toMatchObject({ lastSyncAt: AT, lastFlushAt: flushed });
    expect(dataOf(1).lastFlushAt).toBeNull();
    expect(dataOf(2)).not.toHaveProperty('lastFlushAt');
  });

  it('lists the stations that are not revoked with their organization, by code then name', async () => {
    await repository.activeWithHealth(client);
    const [query] = station.findMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown; select: Record<string, unknown> },
    ];
    expect(query.where).toEqual({ revokedAt: null });
    expect(query.orderBy).toEqual([{ organization: { code: 'asc' } }, { name: 'asc' }]);
    expect(query.select).toMatchObject({
      mqttUsername: true,
      organization: { select: { id: true, code: true, legalName: true } },
      lastFlushAt: true,
      queueDepth: true,
    });
  });
});
