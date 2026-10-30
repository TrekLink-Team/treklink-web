import { DeviceStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

const AT = new Date('2026-10-26T03:00:00.000Z');
const VARIANT = { id: 'v-3', code: 'treklink-v3' };

// The reservation rentals 2.2 calls at approval (FR-CON-03, BR-03).
describe('DevicesService.reserve and release', () => {
  let queryRaw: jest.Mock;
  let updateMany: jest.Mock;
  let tx: Prisma.TransactionClient;
  let service: DevicesService;

  beforeEach(() => {
    queryRaw = jest.fn();
    updateMany = jest.fn().mockResolvedValue({ count: 0 });
    tx = { $queryRaw: queryRaw, device: { updateMany } } as unknown as Prisma.TransactionClient;
    service = new DevicesService(
      new DevicesRepository({} as PrismaService),
      {} as never,
      {} as never,
    );
  });

  it('marks exactly the picked units RESERVED', async () => {
    queryRaw.mockResolvedValue([
      { id: 'd-1', assetTag: 'TL-0001' },
      { id: 'd-2', assetTag: 'TL-0002' },
    ]);
    await expect(service.reserve(VARIANT, 2, AT, tx)).resolves.toHaveLength(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d-1', 'd-2'] } },
      data: { status: DeviceStatus.RESERVED, statusChangedAt: AT, version: { increment: 1 } },
    });
  });

  it('refuses a shortfall with 409 INSUFFICIENT_DEVICES and MSG11, changing nothing', async () => {
    queryRaw.mockResolvedValue([{ id: 'd-1', assetTag: 'TL-0001' }]);
    await expect(service.reserve(VARIANT, 2, AT, tx)).rejects.toMatchObject({
      errorCode: ErrorCode.INSUFFICIENT_DEVICES,
      message:
        'Only 1 treklink-v3 devices are available. Lower the quantity or choose another variant.',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns only RESERVED units to AVAILABLE, and skips an empty release', async () => {
    await service.release(['d-1'], AT, tx);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d-1'] }, status: DeviceStatus.RESERVED },
      data: { status: DeviceStatus.AVAILABLE, statusChangedAt: AT, version: { increment: 1 } },
    });
    updateMany.mockClear();
    await service.release([], AT, tx);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
