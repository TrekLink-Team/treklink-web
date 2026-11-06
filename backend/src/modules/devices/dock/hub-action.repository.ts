import { Injectable } from '@nestjs/common';
import { DeviceStatus, HubActionKind, HubActionOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const HUB_ACTION_SELECT = {
  id: true,
  deviceId: true,
  action: true,
  outcome: true,
  nodeNum: true,
  deviceStatus: true,
  contractId: true,
  contractCode: true,
  firmwareFrom: true,
  firmwareTo: true,
  fullImage: true,
  failure: true,
  actorId: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.DeviceHubActionSelect;

export type HubActionRow = Prisma.DeviceHubActionGetPayload<{ select: typeof HUB_ACTION_SELECT }>;

export interface NewHubAction {
  deviceId: string;
  action: HubActionKind;
  nodeNum: bigint;
  deviceStatus: DeviceStatus;
  contractId: string | null;
  contractCode: string | null;
  firmwareFrom: string | null;
  firmwareTo: string | null;
  fullImage: boolean;
  actorId: string;
  startedAt: Date;
}

// The device hub's action rows (devices design section 12.14, api-design 33 and 34). Rows are never deleted.
@Injectable()
export class HubActionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Locks the device row for the caller's transaction and returns what a hub action checks and keeps.
  async lockDevice(deviceId: string, tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT "id" FROM "devices" WHERE "id" = ${deviceId} FOR UPDATE`;
    return tx.device.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        assetTag: true,
        nodeNum: true,
        status: true,
        statusChangedAt: true,
        firmwareVersion: true,
        keyVersion: true,
        keyOrganizationId: true,
      },
    });
  }

  insert(row: NewHubAction, tx: Prisma.TransactionClient): Promise<HubActionRow> {
    return tx.deviceHubAction.create({ data: row, select: HUB_ACTION_SELECT });
  }

  find(id: string, deviceId: string, tx: Prisma.TransactionClient): Promise<HubActionRow | null> {
    return tx.deviceHubAction.findFirst({ where: { id, deviceId }, select: HUB_ACTION_SELECT });
  }

  finish(
    id: string,
    outcome: HubActionOutcome,
    failure: string | null,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<HubActionRow> {
    return tx.deviceHubAction.update({
      where: { id },
      data: { outcome, failure, finishedAt: at },
      select: HUB_ACTION_SELECT,
    });
  }

  // The rows of one device, oldest first, for the device history (design section 3, monitoring api-design 07).
  ofDevice(deviceId: string, client: Client = this.prisma): Promise<HubActionRow[]> {
    return client.deviceHubAction.findMany({
      where: { deviceId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: HUB_ACTION_SELECT,
    });
  }

  // The unit's key leaves the device record: a factory reset or the TrekLink defaults removed it from the unit.
  clearKey(deviceId: string, tx: Prisma.TransactionClient): Promise<unknown> {
    return tx.device.update({
      where: { id: deviceId },
      data: { keyVersion: null, keyOrganizationId: null, version: { increment: 1 } },
      select: { id: true },
    });
  }

  // The firmware on record after a verified flash from the hub.
  setFirmware(
    deviceId: string,
    firmwareVersion: string,
    tx: Prisma.TransactionClient,
  ): Promise<unknown> {
    return tx.device.update({
      where: { id: deviceId },
      data: { firmwareVersion, version: { increment: 1 } },
      select: { id: true },
    });
  }
}
