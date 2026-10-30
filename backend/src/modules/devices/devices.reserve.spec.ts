import { DeviceStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

const AT = new Date('2026-10-26T03:00:00.000Z');
const VARIANT = { id: 'v-3', code: 'treklink-v3' };
const MOVE = { contractId: 'c-1', contractCode: 'RC-2026-0002', actorId: 'staff-1' };
const contractRow = (
  deviceId: string,
  fromStatus: DeviceStatus,
  toStatus: DeviceStatus,
  reason: string,
) => ({
  deviceId,
  fromStatus,
  toStatus,
  actorId: 'staff-1',
  reason,
  note: 'RC-2026-0002',
  refType: 'CONTRACT',
  refId: 'c-1',
  createdAt: AT,
});

// The reservation rentals 2.2 calls at approval (FR-CON-03, BR-03).
describe('DevicesService.reserve and release', () => {
  let queryRaw: jest.Mock;
  let updateMany: jest.Mock;
  let updateManyAndReturn: jest.Mock;
  let createMany: jest.Mock;
  let tx: Prisma.TransactionClient;
  let service: DevicesService;

  beforeEach(() => {
    queryRaw = jest.fn();
    updateMany = jest.fn().mockResolvedValue({ count: 0 });
    updateManyAndReturn = jest.fn().mockResolvedValue([]);
    createMany = jest.fn().mockResolvedValue({ count: 0 });
    tx = {
      $queryRaw: queryRaw,
      device: { updateMany, updateManyAndReturn },
      deviceTransition: { createMany },
    } as unknown as Prisma.TransactionClient;
    service = new DevicesService(
      new DevicesRepository({} as PrismaService),
      {} as never,
      {} as never,
    );
  });

  it('marks exactly the picked units RESERVED, with a transition row naming the contract', async () => {
    queryRaw.mockResolvedValue([
      { id: 'd-1', assetTag: 'TL-0001' },
      { id: 'd-2', assetTag: 'TL-0002' },
    ]);
    await expect(service.reserve(VARIANT, 2, AT, tx, MOVE)).resolves.toHaveLength(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d-1', 'd-2'] } },
      data: { status: DeviceStatus.RESERVED, statusChangedAt: AT, version: { increment: 1 } },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: ['d-1', 'd-2'].map((id) =>
        contractRow(id, DeviceStatus.AVAILABLE, DeviceStatus.RESERVED, 'RESERVED'),
      ),
    });
  });

  it('refuses a shortfall with 409 INSUFFICIENT_DEVICES and MSG11, changing nothing', async () => {
    queryRaw.mockResolvedValue([{ id: 'd-1', assetTag: 'TL-0001' }]);
    await expect(service.reserve(VARIANT, 2, AT, tx, MOVE)).rejects.toMatchObject({
      errorCode: ErrorCode.INSUFFICIENT_DEVICES,
      message:
        'Only 1 treklink-v3 devices are available. Lower the quantity or choose another variant.',
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('names a chosen unit that is not AVAILABLE with 409 DEVICE_NOT_AVAILABLE, changing nothing', async () => {
    queryRaw.mockResolvedValue([{ id: 'd-1', assetTag: 'TL-0001' }]);
    const findMany = jest.fn().mockResolvedValue([{ id: 'd-2', assetTag: 'TL-0002' }]);
    tx = {
      $queryRaw: queryRaw,
      device: { updateMany, findMany },
      deviceTransition: { createMany },
    } as unknown as Prisma.TransactionClient;

    await expect(service.reserve(VARIANT, 2, AT, tx, MOVE, ['d-1', 'd-2'])).rejects.toMatchObject({
      errorCode: ErrorCode.DEVICE_NOT_AVAILABLE,
      message:
        'TL-0002 is not an available treklink-v3 device. Choose available units of the variant.',
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['d-2'] } },
      select: { id: true, assetTag: true },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('names every refused choice, and the id of one that does not exist', async () => {
    queryRaw.mockResolvedValue([]);
    const findMany = jest.fn().mockResolvedValue([{ id: 'd-2', assetTag: 'TL-0002' }]);
    tx = {
      $queryRaw: queryRaw,
      device: { updateMany, findMany },
      deviceTransition: { createMany },
    } as unknown as Prisma.TransactionClient;

    await expect(service.reserve(VARIANT, 2, AT, tx, MOVE, ['d-2', 'd-x'])).rejects.toMatchObject({
      errorCode: ErrorCode.DEVICE_NOT_AVAILABLE,
      message:
        'TL-0002, d-x are not available treklink-v3 devices. Choose available units of the variant.',
    });
  });

  it('filters explicit choices under the same variant, availability and row locks', async () => {
    queryRaw.mockResolvedValue([{ id: 'd-2', assetTag: 'TL-0002' }]);
    await service.reserve(VARIANT, 1, AT, tx, MOVE, ['d-2']);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = Prisma.sql(strings, ...values);
    expect(sql.text).toContain('"hardwareVariantId" = $1');
    expect(sql.text).toContain('"status" = \'AVAILABLE\'');
    expect(sql.text).toContain('AND "id" IN ($2)');
    expect(sql.text).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql.values).toEqual(['v-3', 'd-2', 1]);
  });

  it('does not replace an unavailable explicit choice with a different device', async () => {
    queryRaw.mockResolvedValue([]);
    const findMany = jest.fn().mockResolvedValue([{ id: 'd-2', assetTag: 'TL-0002' }]);
    tx = {
      $queryRaw: queryRaw,
      device: { updateMany, findMany },
      deviceTransition: { createMany },
    } as unknown as Prisma.TransactionClient;
    await expect(service.reserve(VARIANT, 1, AT, tx, MOVE, ['d-2'])).rejects.toMatchObject({
      errorCode: ErrorCode.DEVICE_NOT_AVAILABLE,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns only RESERVED units to AVAILABLE with a row each for those moved, and skips an empty release', async () => {
    updateManyAndReturn.mockResolvedValue([{ id: 'd-1' }]);
    await service.release(['d-1', 'd-9'], AT, tx, MOVE);
    expect(updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: { in: ['d-1', 'd-9'] }, status: DeviceStatus.RESERVED },
      data: { status: DeviceStatus.AVAILABLE, statusChangedAt: AT, version: { increment: 1 } },
      select: { id: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [contractRow('d-1', DeviceStatus.RESERVED, DeviceStatus.AVAILABLE, 'RELEASED')],
    });
    updateManyAndReturn.mockClear();
    createMany.mockClear();
    await service.release([], AT, tx, MOVE);
    expect(updateManyAndReturn).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('writes a row per unit for the handover, the check-in and a replacement return', async () => {
    updateManyAndReturn.mockResolvedValue([{ id: 'd-1' }, { id: 'd-2' }]);
    await service.markRented(['d-1', 'd-2'], AT, tx, MOVE);
    expect(updateManyAndReturn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: { in: ['d-1', 'd-2'] }, status: DeviceStatus.RESERVED },
      }),
    );
    expect(createMany).toHaveBeenLastCalledWith({
      data: ['d-1', 'd-2'].map((id) =>
        contractRow(id, DeviceStatus.RESERVED, DeviceStatus.RENTED, 'HANDED_OVER'),
      ),
    });

    await service.markReturned(['d-1', 'd-2'], AT, tx, MOVE);
    expect(createMany).toHaveBeenLastCalledWith({
      data: ['d-1', 'd-2'].map((id) =>
        contractRow(id, DeviceStatus.RENTED, DeviceStatus.RETURNED, 'CHECKED_IN'),
      ),
    });

    updateManyAndReturn.mockResolvedValue([{ id: 'd-1' }]);
    await service.markReturned(['d-1'], AT, tx, { ...MOVE, reason: 'REPLACED' });
    expect(createMany).toHaveBeenLastCalledWith({
      data: [contractRow('d-1', DeviceStatus.RENTED, DeviceStatus.RETURNED, 'REPLACED')],
    });
  });

  it('writes no row for a unit that was not in the source status', async () => {
    updateManyAndReturn.mockResolvedValue([]);
    await service.markReturned(['d-1'], AT, tx, MOVE);
    expect(createMany).not.toHaveBeenCalled();
  });
});
