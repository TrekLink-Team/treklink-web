import { HttpStatus } from '@nestjs/common';
import { DockEndReason } from '@prisma/client';
import { Caller } from '../../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { DEVICE_DOCKED, DEVICE_UNDOCKED } from './dock-events';
import { DockSessionService } from './dock-session.service';

// devices design section 12.8, task 10.3, api-design 31 and 32, REQ-EVT-38, REQ-EVT-39, REQ-ERR-29.
// The database behaviour (row lock, partial unique index) is covered by test/dock-sessions.db-spec.ts;
// this file covers the decisions of the service with the repositories mocked.

const AT = new Date('2026-11-20T03:00:00.000Z');
const TTL_SECONDS = 90;
const NODE = BigInt(0x0aa3a274);
const STAFF = { id: 'staff-1', roles: ['STAFF'], organizationId: null } as Caller;
const UNIT = { id: 'd-1', assetTag: 'TL-0042', nodeNum: NODE };

const secondsBefore = (seconds: number) => new Date(AT.getTime() - seconds * 1000);

const session = (extra: Record<string, unknown> = {}) => ({
  id: 's-1',
  deviceId: 'd-1',
  nodeNum: NODE,
  openedById: 'staff-1',
  openedAt: secondsBefore(300),
  renewedAt: secondsBefore(30),
  endedAt: null,
  endReason: null,
  ...extra,
});

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    const domain = error as DomainException;
    return { status: domain.getStatus(), code: domain.errorCode, message: domain.message };
  }
  throw new Error('expected a DomainException');
};

describe('DockSessionService', () => {
  let devices: { identity: jest.Mock };
  let sessions: {
    lockOpen: jest.Mock;
    renew: jest.Mock;
    end: jest.Mock;
    insert: jest.Mock;
    stale: jest.Mock;
    endIfStale: jest.Mock;
  };
  let parameters: { get: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let directory: { namesOf: jest.Mock };
  let tx: { $queryRaw: jest.Mock };
  let service: DockSessionService;

  beforeEach(() => {
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'd-1' }]) };
    devices = { identity: jest.fn().mockResolvedValue(UNIT) };
    sessions = {
      lockOpen: jest.fn().mockResolvedValue(null),
      renew: jest.fn((id: string, at: Date) => Promise.resolve(session({ id, renewedAt: at }))),
      end: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn((data: { at: Date; openedById: string }) =>
        Promise.resolve(
          session({
            id: 's-2',
            openedById: data.openedById,
            openedAt: data.at,
            renewedAt: data.at,
          }),
        ),
      ),
      stale: jest.fn().mockResolvedValue([]),
      endIfStale: jest.fn().mockResolvedValue(true),
    };
    parameters = { get: jest.fn().mockResolvedValue(TTL_SECONDS) };
    events = {
      transaction: jest.fn((work: (client: object) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    directory = { namesOf: jest.fn().mockResolvedValue(new Map([['staff-1', 'Tran Thi B']])) };
    service = new DockSessionService(
      devices as never,
      sessions as never,
      parameters as never,
      events as never,
      directory,
    );
  });

  describe('dock (api-design 31)', () => {
    it('opens a session when the unit has none, and announces it after commit', async () => {
      await expect(service.dock('d-1', NODE, STAFF, AT)).resolves.toEqual({
        deviceId: 'd-1',
        assetTag: 'TL-0042',
        since: AT,
        renewedAt: AT,
        expiresAt: new Date(AT.getTime() + TTL_SECONDS * 1000),
      });
      expect(parameters.get).toHaveBeenCalledWith('devices.dockPresenceTtlSeconds');
      expect(tx.$queryRaw).toHaveBeenCalledWith(expect.anything(), 'd-1');
      expect(devices.identity).toHaveBeenCalledWith('d-1', tx);
      expect(sessions.insert).toHaveBeenCalledWith(
        { deviceId: 'd-1', nodeNum: NODE, openedById: 'staff-1', at: AT },
        tx,
      );
      expect(sessions.end).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).toHaveBeenCalledTimes(1);
      expect(events.emitAfterCommit).toHaveBeenCalledWith(DEVICE_DOCKED, {
        deviceId: 'd-1',
        assetTag: 'TL-0042',
        since: AT,
        byName: 'Tran Thi B',
      });
    });

    it('locks the device row before it reads the open session', async () => {
      await service.dock('d-1', NODE, STAFF, AT);
      const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(devices.identity.mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(sessions.lockOpen.mock.invocationCallOrder[0]);
    });

    it("renews the caller's own unexpired session, with no event", async () => {
      sessions.lockOpen.mockResolvedValue(session({ renewedAt: secondsBefore(30) }));
      const view = await service.dock('d-1', NODE, STAFF, AT);
      expect(sessions.renew).toHaveBeenCalledWith('s-1', AT, tx);
      expect(sessions.insert).not.toHaveBeenCalled();
      expect(sessions.end).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
      expect(view.since).toEqual(secondsBefore(300));
      expect(view.expiresAt).toEqual(new Date(AT.getTime() + TTL_SECONDS * 1000));
    });

    it('still counts a session renewed exactly one TTL ago as unexpired', async () => {
      sessions.lockOpen.mockResolvedValue(session({ renewedAt: secondsBefore(TTL_SECONDS) }));
      await service.dock('d-1', NODE, STAFF, AT);
      expect(sessions.renew).toHaveBeenCalledWith('s-1', AT, tx);
      expect(sessions.end).not.toHaveBeenCalled();
    });

    it('replaces an unexpired session someone else opened', async () => {
      sessions.lockOpen.mockResolvedValue(session({ openedById: 'staff-2' }));
      await service.dock('d-1', NODE, STAFF, AT);
      expect(sessions.end).toHaveBeenCalledWith('s-1', AT, DockEndReason.REPLACED, tx);
      expect(sessions.renew).not.toHaveBeenCalled();
      expect(sessions.insert).toHaveBeenCalledTimes(1);
      expect(events.emitAfterCommit.mock.calls).toEqual([
        [DEVICE_UNDOCKED, { deviceId: 'd-1', endedAt: AT, endReason: DockEndReason.REPLACED }],
        [DEVICE_DOCKED, { deviceId: 'd-1', assetTag: 'TL-0042', since: AT, byName: 'Tran Thi B' }],
      ]);
    });

    it("ends the caller's own session as EXPIRED once it is past the TTL, then opens a new one", async () => {
      sessions.lockOpen.mockResolvedValue(session({ renewedAt: secondsBefore(TTL_SECONDS + 1) }));
      await service.dock('d-1', NODE, STAFF, AT);
      expect(sessions.end).toHaveBeenCalledWith('s-1', AT, DockEndReason.EXPIRED, tx);
      expect(sessions.renew).not.toHaveBeenCalled();
      expect(sessions.insert).toHaveBeenCalledTimes(1);
      expect(events.emitAfterCommit).toHaveBeenCalledWith(DEVICE_UNDOCKED, {
        deviceId: 'd-1',
        endedAt: AT,
        endReason: DockEndReason.EXPIRED,
      });
    });

    it('refuses with 409 NODE_MISMATCH when the docked unit is another device (REQ-ERR-29)', async () => {
      await expect(failureOf(service.dock('d-1', BigInt(0x0aa3a275), STAFF, AT))).resolves.toEqual({
        status: HttpStatus.CONFLICT,
        code: ErrorCode.NODE_MISMATCH,
        message: 'The docked unit is !0aa3a275, not TL-0042.',
      });
      expect(sessions.lockOpen).not.toHaveBeenCalled();
      expect(sessions.insert).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('refuses with 404 NOT_FOUND for an unknown device', async () => {
      devices.identity.mockResolvedValue(null);
      await expect(failureOf(service.dock('d-9', NODE, STAFF, AT))).resolves.toEqual({
        status: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        message: 'Device not found.',
      });
      expect(sessions.lockOpen).not.toHaveBeenCalled();
    });

    it('announces no name when the directory does not know the caller', async () => {
      directory.namesOf.mockResolvedValue(new Map());
      await service.dock('d-1', NODE, STAFF, AT);
      expect(directory.namesOf).toHaveBeenCalledWith(['staff-1']);
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        DEVICE_DOCKED,
        expect.objectContaining({ byName: null }),
      );
    });

    it('announces no name when no account directory is bound', async () => {
      const bare = new DockSessionService(
        devices as never,
        sessions as never,
        parameters as never,
        events as never,
      );
      await bare.dock('d-1', NODE, STAFF, AT);
      expect(directory.namesOf).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        DEVICE_DOCKED,
        expect.objectContaining({ byName: null }),
      );
    });
  });

  describe('undock (api-design 32)', () => {
    it('ends the open session as RELEASED, whoever opened it', async () => {
      sessions.lockOpen.mockResolvedValue(session({ openedById: 'staff-2' }));
      await expect(service.undock('d-1', AT)).resolves.toBeNull();
      expect(tx.$queryRaw).toHaveBeenCalledWith(expect.anything(), 'd-1');
      expect(sessions.end).toHaveBeenCalledWith('s-1', AT, DockEndReason.RELEASED, tx);
      expect(events.emitAfterCommit).toHaveBeenCalledWith(DEVICE_UNDOCKED, {
        deviceId: 'd-1',
        endedAt: AT,
        endReason: DockEndReason.RELEASED,
      });
    });

    it('succeeds with nothing to end when the unit has no open session', async () => {
      await expect(service.undock('d-1', AT)).resolves.toBeNull();
      expect(sessions.end).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('refuses with 404 NOT_FOUND for an unknown device', async () => {
      devices.identity.mockResolvedValue(null);
      await expect(failureOf(service.undock('d-9', AT))).resolves.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
      });
      expect(sessions.lockOpen).not.toHaveBeenCalled();
    });
  });

  describe('expireStale (the devices.dockSweep job)', () => {
    it('ends every session not renewed within the TTL, each in its own transaction', async () => {
      const staleBefore = secondsBefore(TTL_SECONDS);
      sessions.stale.mockResolvedValue([
        session({ id: 's-1', deviceId: 'd-1' }),
        session({ id: 's-2', deviceId: 'd-2' }),
      ]);
      await expect(service.expireStale(AT)).resolves.toBe(2);
      expect(sessions.stale).toHaveBeenCalledWith(staleBefore);
      expect(events.transaction).toHaveBeenCalledTimes(2);
      expect(sessions.endIfStale.mock.calls).toEqual([
        ['s-1', staleBefore, AT, tx],
        ['s-2', staleBefore, AT, tx],
      ]);
      expect(events.emitAfterCommit.mock.calls).toEqual([
        [DEVICE_UNDOCKED, { deviceId: 'd-1', endedAt: AT, endReason: DockEndReason.EXPIRED }],
        [DEVICE_UNDOCKED, { deviceId: 'd-2', endedAt: AT, endReason: DockEndReason.EXPIRED }],
      ]);
    });

    it('skips and does not count a session renewed or ended meanwhile', async () => {
      sessions.stale.mockResolvedValue([
        session({ id: 's-1', deviceId: 'd-1' }),
        session({ id: 's-2', deviceId: 'd-2' }),
      ]);
      sessions.endIfStale.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await expect(service.expireStale(AT)).resolves.toBe(1);
      expect(events.emitAfterCommit).toHaveBeenCalledTimes(1);
      expect(events.emitAfterCommit).toHaveBeenCalledWith(DEVICE_UNDOCKED, {
        deviceId: 'd-2',
        endedAt: AT,
        endReason: DockEndReason.EXPIRED,
      });
    });

    it('returns 0 and opens no transaction when nothing is stale', async () => {
      await expect(service.expireStale(AT)).resolves.toBe(0);
      expect(events.transaction).not.toHaveBeenCalled();
    });
  });
});
