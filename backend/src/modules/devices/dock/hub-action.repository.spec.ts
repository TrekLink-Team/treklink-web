import { DeviceStatus, HubActionKind, HubActionOutcome } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { HUB_ACTION_SELECT, HubActionRepository, NewHubAction } from './hub-action.repository';

// devices design section 12.14, api-design 33 and 34: the Prisma calls behind the hub action rows.
// The service decisions are covered by hub-action.service.spec.ts; this file asserts the where
// clauses, the selected columns, the ordering and the version bump on the device writes.

const AT = new Date('2026-11-20T03:00:00.000Z');
const NODE = BigInt(0x0aa3a274);

const actionRow = (extra: Record<string, unknown> = {}) => ({
  id: 'ha-1',
  deviceId: 'd-1',
  action: HubActionKind.FACTORY_RESET,
  outcome: HubActionOutcome.STARTED,
  nodeNum: NODE,
  deviceStatus: DeviceStatus.AVAILABLE,
  contractId: null,
  contractCode: null,
  firmwareFrom: null,
  firmwareTo: null,
  fullImage: false,
  failure: null,
  actorId: 'staff-1',
  startedAt: AT,
  finishedAt: null,
  ...extra,
});

const aClient = () => ({
  $queryRaw: jest.fn().mockResolvedValue([{ id: 'd-1' }]),
  device: {
    findUnique: jest.fn().mockResolvedValue({ id: 'd-1' }),
    update: jest.fn().mockResolvedValue({ id: 'd-1' }),
  },
  deviceHubAction: {
    create: jest.fn().mockResolvedValue(actionRow()),
    findFirst: jest.fn().mockResolvedValue(actionRow()),
    update: jest.fn().mockResolvedValue(actionRow()),
    findMany: jest.fn().mockResolvedValue([actionRow()]),
  },
});

describe('HubActionRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: HubActionRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new HubActionRepository(prisma as unknown as PrismaService);
  });

  it('selects every column of the hub action row', () => {
    expect(Object.keys(HUB_ACTION_SELECT)).toHaveLength(15);
    expect(Object.values(HUB_ACTION_SELECT).every((picked) => picked === true)).toBe(true);
  });

  describe('lockDevice', () => {
    it('locks the device row first, then reads what a hub action checks and keeps', async () => {
      await expect(repository.lockDevice('d-1', tx as never)).resolves.toEqual({ id: 'd-1' });

      const [strings, deviceId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
      const sql = strings.join('?').replace(/\s+/g, ' ');
      expect(sql).toBe('SELECT "id" FROM "devices" WHERE "id" = ? FOR UPDATE');
      expect(deviceId).toBe('d-1');
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.device.findUnique.mock.invocationCallOrder[0],
      );
      expect(tx.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        select: {
          id: true,
          assetTag: true,
          nodeNum: true,
          status: true,
          statusChangedAt: true,
          firmwareVersion: true,
          keyVersion: true,
          keyOrganizationId: true,
          provisionedAt: true,
        },
      });
      expect(prisma.device.findUnique).not.toHaveBeenCalled();
    });

    it('returns null for an unknown device, so the service can answer 404', async () => {
      tx.device.findUnique.mockResolvedValue(null);
      await expect(repository.lockDevice('d-9', tx as never)).resolves.toBeNull();
    });
  });

  describe('insert', () => {
    it('writes the new row as given and reads it back with the full select', async () => {
      const row: NewHubAction = {
        deviceId: 'd-1',
        action: HubActionKind.FIRMWARE_UPDATE,
        nodeNum: NODE,
        deviceStatus: DeviceStatus.RENTED,
        contractId: 'c-1',
        contractCode: 'CT-2026-0001',
        firmwareFrom: '2.7.18',
        firmwareTo: '2.7.19-treklink.3',
        fullImage: true,
        actorId: 'staff-1',
        startedAt: AT,
      };
      await repository.insert(row, tx as never);
      expect(tx.deviceHubAction.create).toHaveBeenCalledWith({
        data: row,
        select: HUB_ACTION_SELECT,
      });
    });
  });

  describe('find', () => {
    it('reads the action only within its own device', async () => {
      await expect(repository.find('ha-1', 'd-1', tx as never)).resolves.toEqual(actionRow());
      expect(tx.deviceHubAction.findFirst).toHaveBeenCalledWith({
        where: { id: 'ha-1', deviceId: 'd-1' },
        select: HUB_ACTION_SELECT,
      });
    });

    it('returns null when the action belongs to another device', async () => {
      tx.deviceHubAction.findFirst.mockResolvedValue(null);
      await expect(repository.find('ha-1', 'd-2', tx as never)).resolves.toBeNull();
    });
  });

  describe('finish', () => {
    it.each([
      [HubActionOutcome.SUCCEEDED, null],
      [HubActionOutcome.FAILED, 'The unit did not answer after the flash.'],
    ])('records the outcome %s, the failure text and the finish time', async (outcome, failure) => {
      await repository.finish('ha-1', outcome, failure, AT, tx as never);
      expect(tx.deviceHubAction.update).toHaveBeenCalledWith({
        where: { id: 'ha-1' },
        data: { outcome, failure, finishedAt: AT },
        select: HUB_ACTION_SELECT,
      });
    });
  });

  describe('ofDevice', () => {
    it('reads the rows of one device oldest first, with the id breaking a tie', async () => {
      await expect(repository.ofDevice('d-1')).resolves.toEqual([actionRow()]);
      expect(prisma.deviceHubAction.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        select: HUB_ACTION_SELECT,
      });
    });

    it('reads through the transaction client when one is given', async () => {
      await repository.ofDevice('d-1', tx as never);
      expect(tx.deviceHubAction.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.deviceHubAction.findMany).not.toHaveBeenCalled();
    });
  });

  describe('clearKey', () => {
    it('removes the key, its organization and the provisioning time, and bumps the version', async () => {
      await repository.clearKey('d-1', tx as never);
      expect(tx.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: {
          keyVersion: null,
          keyOrganizationId: null,
          provisionedAt: null,
          version: { increment: 1 },
        },
        select: { id: true },
      });
    });
  });

  describe('setFirmware', () => {
    it('records the flashed firmware and bumps the version', async () => {
      await repository.setFirmware('d-1', '2.7.19-treklink.3', tx as never);
      expect(tx.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { firmwareVersion: '2.7.19-treklink.3', version: { increment: 1 } },
        select: { id: true },
      });
    });
  });
});
