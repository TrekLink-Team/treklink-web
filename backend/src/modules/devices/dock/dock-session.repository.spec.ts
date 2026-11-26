import { DockEndReason } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DOCK_SESSION_SELECT, DockSessionRepository } from './dock-session.repository';

// devices design section 12.8: the Prisma calls behind the dock sessions. The partial unique index and
// the row lock are exercised against Postgres by test/dock-sessions.db-spec.ts; this file asserts the
// where clauses, the selected columns and the row handling with the client mocked.

const AT = new Date('2026-11-20T03:00:00.000Z');
const BEFORE = new Date('2026-11-20T02:58:30.000Z');
const NODE = BigInt(0x0aa3a274);

const row = (extra: Record<string, unknown> = {}) => ({
  id: 's-1',
  deviceId: 'd-1',
  nodeNum: NODE,
  openedById: 'staff-1',
  openedAt: AT,
  renewedAt: AT,
  endedAt: null,
  endReason: null,
  ...extra,
});

type SessionDelegate = {
  findMany: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

const aClient = () => ({
  $queryRaw: jest.fn(),
  deviceDockSession: {
    findMany: jest.fn().mockResolvedValue([row()]),
    findUnique: jest.fn().mockResolvedValue(row()),
    create: jest.fn().mockResolvedValue(row()),
    update: jest.fn().mockResolvedValue(row()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  } satisfies SessionDelegate,
});

describe('DockSessionRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: DockSessionRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new DockSessionRepository(prisma as unknown as PrismaService);
  });

  it('selects the session columns the service reads, and no others', () => {
    expect(Object.keys(DOCK_SESSION_SELECT).sort()).toEqual(
      [
        'deviceId',
        'endReason',
        'endedAt',
        'id',
        'nodeNum',
        'openedAt',
        'openedById',
        'renewedAt',
      ].sort(),
    );
  });

  describe('open', () => {
    it('reads the unended sessions renewed since the given time, oldest first', async () => {
      await expect(repository.open(BEFORE)).resolves.toEqual([row()]);
      expect(prisma.deviceDockSession.findMany).toHaveBeenCalledWith({
        where: { endedAt: null, renewedAt: { gte: BEFORE } },
        select: DOCK_SESSION_SELECT,
        orderBy: { openedAt: 'asc' },
      });
    });

    it('narrows to the given devices, copying the list it was handed', async () => {
      const ids = ['d-1', 'd-2'] as const;
      await repository.open(BEFORE, ids);
      const [{ where }] = prisma.deviceDockSession.findMany.mock.calls[0] as [
        { where: { deviceId: { in: string[] } } },
      ];
      expect(where.deviceId).toEqual({ in: ['d-1', 'd-2'] });
      expect(where.deviceId.in).not.toBe(ids);
    });

    it('reads through the transaction client when one is given', async () => {
      await repository.open(BEFORE, undefined, tx as never);
      expect(tx.deviceDockSession.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.deviceDockSession.findMany).not.toHaveBeenCalled();
    });
  });

  describe('lockOpen', () => {
    it('locks the open session row of the device, then reads it by its id', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: 's-7' }]);
      tx.deviceDockSession.findUnique.mockResolvedValue(row({ id: 's-7' }));
      await expect(repository.lockOpen('d-1', tx as never)).resolves.toEqual(row({ id: 's-7' }));

      const [strings, deviceId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
      const sql = strings.join('?').replace(/\s+/g, ' ');
      expect(sql).toContain('FROM "device_dock_sessions"');
      expect(sql).toContain('"endedAt" IS NULL');
      expect(sql).toContain('FOR UPDATE');
      expect(deviceId).toBe('d-1');
      expect(tx.deviceDockSession.findUnique).toHaveBeenCalledWith({
        where: { id: 's-7' },
        select: DOCK_SESSION_SELECT,
      });
    });

    it('returns null and reads nothing more when the device has no open session', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(repository.lockOpen('d-1', tx as never)).resolves.toBeNull();
      expect(tx.deviceDockSession.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('insert', () => {
    it('opens a session with the opening time as its first renewal', async () => {
      await repository.insert(
        { deviceId: 'd-1', nodeNum: NODE, openedById: 'staff-1', at: AT },
        tx as never,
      );
      expect(tx.deviceDockSession.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'd-1',
          nodeNum: NODE,
          openedById: 'staff-1',
          openedAt: AT,
          renewedAt: AT,
        },
        select: DOCK_SESSION_SELECT,
      });
    });
  });

  describe('renew', () => {
    it('moves only the renewal time', async () => {
      await repository.renew('s-1', AT, tx as never);
      expect(tx.deviceDockSession.update).toHaveBeenCalledWith({
        where: { id: 's-1' },
        data: { renewedAt: AT },
        select: DOCK_SESSION_SELECT,
      });
    });
  });

  describe('end', () => {
    it.each(Object.values(DockEndReason))(
      'records the end time and the reason %s',
      async (reason) => {
        await repository.end('s-1', AT, reason, tx as never);
        expect(tx.deviceDockSession.update).toHaveBeenCalledWith({
          where: { id: 's-1' },
          data: { endedAt: AT, endReason: reason },
          select: DOCK_SESSION_SELECT,
        });
      },
    );
  });

  describe('stale', () => {
    it('reads the unended sessions renewed strictly before the cut-off', async () => {
      await repository.stale(BEFORE);
      expect(prisma.deviceDockSession.findMany).toHaveBeenCalledWith({
        where: { endedAt: null, renewedAt: { lt: BEFORE } },
        select: DOCK_SESSION_SELECT,
      });
    });
  });

  describe('endIfStale', () => {
    it('ends the session as EXPIRED only while it is still unended and stale', async () => {
      await expect(repository.endIfStale('s-1', BEFORE, AT, tx as never)).resolves.toBe(true);
      expect(tx.deviceDockSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', endedAt: null, renewedAt: { lt: BEFORE } },
        data: { endedAt: AT, endReason: DockEndReason.EXPIRED },
      });
    });

    it('reports false when the session was renewed or ended meanwhile', async () => {
      tx.deviceDockSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(repository.endIfStale('s-1', BEFORE, AT, tx as never)).resolves.toBe(false);
    });
  });
});
