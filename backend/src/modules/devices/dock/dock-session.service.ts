import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { DockEndReason, Prisma } from '@prisma/client';
import { Caller } from '../../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../../platform/ports/account-directory.port';
import { DevicesRepository } from '../devices.repository';
import { toNodeId } from '../node-id';
import {
  DEVICE_DOCKED,
  DEVICE_UNDOCKED,
  DeviceDockedEvent,
  DeviceUndockedEvent,
} from './dock-events';
import { DockSessionRepository, DockSessionRow } from './dock-session.repository';

// devices api-design 31: the session as the connector holds it.
export interface DockSessionView {
  deviceId: string;
  assetTag: string;
  since: Date;
  renewedAt: Date;
  expiresAt: Date;
}

const SECOND_MS = 1000;

// The dock sessions behind the Staff map pin of a unit held at the counter (devices design section 11.8,
// task 10.3, REQ-EVT-36, REQ-EVT-37). The device row is locked first, so two requests for one unit run
// one after the other and the partial unique index never fires on a race.
@Injectable()
export class DockSessionService {
  constructor(
    private readonly devices: DevicesRepository,
    private readonly sessions: DockSessionRepository,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  // devices api-design 31: opens a session, or renews the caller's own unexpired one. A session someone
  // else opened, or one past its time, ends (`REPLACED` or `EXPIRED`) and a new one opens. The node
  // number read from the unit must be the device's (REQ-ERR-27).
  async dock(
    deviceId: string,
    nodeNum: bigint,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<DockSessionView> {
    const ttl = await this.parameters.get('devices.dockPresenceTtlSeconds');
    const byName = await this.nameOf(actor.id);
    return this.events.transaction(async (tx) => {
      const unit = await this.lockedUnit(deviceId, tx);
      if (unit.nodeNum !== nodeNum) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.NODE_MISMATCH,
          `The docked unit is ${toNodeId(nodeNum)}, not ${unit.assetTag}.`,
        );
      }
      const open = await this.sessions.lockOpen(deviceId, tx);
      const fresh = open !== null && open.renewedAt.getTime() >= at.getTime() - ttl * SECOND_MS;
      let session: DockSessionRow;
      if (open && fresh && open.openedById === actor.id) {
        session = await this.sessions.renew(open.id, at, tx);
      } else {
        if (open) {
          const reason = fresh ? DockEndReason.REPLACED : DockEndReason.EXPIRED;
          await this.sessions.end(open.id, at, reason, tx);
          this.events.emitAfterCommit(DEVICE_UNDOCKED, {
            deviceId,
            endedAt: at,
            endReason: reason,
          } satisfies DeviceUndockedEvent);
        }
        session = await this.sessions.insert({ deviceId, nodeNum, openedById: actor.id, at }, tx);
        this.events.emitAfterCommit(DEVICE_DOCKED, {
          deviceId,
          assetTag: unit.assetTag,
          since: session.openedAt,
          byName,
        } satisfies DeviceDockedEvent);
      }
      return {
        deviceId,
        assetTag: unit.assetTag,
        since: session.openedAt,
        renewedAt: session.renewedAt,
        expiresAt: new Date(session.renewedAt.getTime() + ttl * SECOND_MS),
      };
    });
  }

  // devices api-design 32: ends the open session as RELEASED. No open session is not an error, so a
  // tab that closes after its session expired gets success too.
  async undock(deviceId: string, at: Date = new Date()): Promise<null> {
    return this.events.transaction(async (tx) => {
      await this.lockedUnit(deviceId, tx);
      const open = await this.sessions.lockOpen(deviceId, tx);
      if (open) {
        await this.sessions.end(open.id, at, DockEndReason.RELEASED, tx);
        this.events.emitAfterCommit(DEVICE_UNDOCKED, {
          deviceId,
          endedAt: at,
          endReason: DockEndReason.RELEASED,
        } satisfies DeviceUndockedEvent);
      }
      return null;
    });
  }

  // The devices.dockSweep job: ends every session not renewed within the TTL as EXPIRED, each in its own
  // transaction, skipping one renewed or ended meanwhile.
  async expireStale(at: Date = new Date()): Promise<number> {
    const ttl = await this.parameters.get('devices.dockPresenceTtlSeconds');
    const staleBefore = new Date(at.getTime() - ttl * SECOND_MS);
    let ended = 0;
    for (const session of await this.sessions.stale(staleBefore)) {
      const done = await this.events.transaction(async (tx) => {
        if (!(await this.sessions.endIfStale(session.id, staleBefore, at, tx))) return false;
        this.events.emitAfterCommit(DEVICE_UNDOCKED, {
          deviceId: session.deviceId,
          endedAt: at,
          endReason: DockEndReason.EXPIRED,
        } satisfies DeviceUndockedEvent);
        return true;
      });
      if (done) ended += 1;
    }
    return ended;
  }

  private async lockedUnit(deviceId: string, tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT "id" FROM "devices" WHERE "id" = ${deviceId} FOR UPDATE`;
    const unit = await this.devices.identity(deviceId, tx);
    if (!unit) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');
    }
    return unit;
  }

  private async nameOf(userId: string): Promise<string | null> {
    if (!this.directory) return null;
    return (await this.directory.namesOf([userId])).get(userId) ?? null;
  }
}
