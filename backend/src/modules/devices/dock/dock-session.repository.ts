import { Injectable } from '@nestjs/common';
import { DockEndReason, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const DOCK_SESSION_SELECT = {
  id: true,
  deviceId: true,
  nodeNum: true,
  openedById: true,
  openedAt: true,
  renewedAt: true,
  endedAt: true,
  endReason: true,
} satisfies Prisma.DeviceDockSessionSelect;

export type DockSessionRow = Prisma.DeviceDockSessionGetPayload<{
  select: typeof DOCK_SESSION_SELECT;
}>;

// The dock sessions of devices design section 11.8: a Staff browser holding a unit's port at the
// counter. One open session per device, kept by the partial unique index of the migration.
@Injectable()
export class DockSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The open sessions renewed at or after `freshSince`, of these devices or of every device.
  open(
    freshSince: Date,
    deviceIds?: readonly string[],
    client: Client = this.prisma,
  ): Promise<DockSessionRow[]> {
    return client.deviceDockSession.findMany({
      where: {
        endedAt: null,
        renewedAt: { gte: freshSince },
        ...(deviceIds ? { deviceId: { in: [...deviceIds] } } : {}),
      },
      select: DOCK_SESSION_SELECT,
      orderBy: { openedAt: 'asc' },
    });
  }

  // The open session of a device, locked for the caller's transaction.
  async lockOpen(deviceId: string, tx: Prisma.TransactionClient): Promise<DockSessionRow | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "device_dock_sessions"
      WHERE "deviceId" = ${deviceId} AND "endedAt" IS NULL
      FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.deviceDockSession.findUnique({
      where: { id: rows[0].id },
      select: DOCK_SESSION_SELECT,
    });
  }

  insert(
    session: { deviceId: string; nodeNum: bigint; openedById: string; at: Date },
    tx: Prisma.TransactionClient,
  ): Promise<DockSessionRow> {
    return tx.deviceDockSession.create({
      data: {
        deviceId: session.deviceId,
        nodeNum: session.nodeNum,
        openedById: session.openedById,
        openedAt: session.at,
        renewedAt: session.at,
      },
      select: DOCK_SESSION_SELECT,
    });
  }

  renew(id: string, at: Date, tx: Prisma.TransactionClient): Promise<DockSessionRow> {
    return tx.deviceDockSession.update({
      where: { id },
      data: { renewedAt: at },
      select: DOCK_SESSION_SELECT,
    });
  }

  end(id: string, at: Date, reason: DockEndReason, tx: Prisma.TransactionClient) {
    return tx.deviceDockSession.update({
      where: { id },
      data: { endedAt: at, endReason: reason },
      select: DOCK_SESSION_SELECT,
    });
  }

  // Open sessions not renewed since `staleBefore`, for the devices.dockSweep job.
  stale(staleBefore: Date, client: Client = this.prisma): Promise<DockSessionRow[]> {
    return client.deviceDockSession.findMany({
      where: { endedAt: null, renewedAt: { lt: staleBefore } },
      select: DOCK_SESSION_SELECT,
    });
  }

  // Ends a stale session unless it was renewed or ended meanwhile; true when this call ended it.
  async endIfStale(
    id: string,
    staleBefore: Date,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await tx.deviceDockSession.updateMany({
      where: { id, endedAt: null, renewedAt: { lt: staleBefore } },
      data: { endedAt: at, endReason: DockEndReason.EXPIRED },
    });
    return count === 1;
  }
}
