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

  it('filters explicit choices under the same variant, availability and row locks', async () => {
    queryRaw.mockResolvedValue([{ id: 'd-2', assetTag: 'TL-0002' }]);
    await service.reserve(VARIANT, 1, AT, tx, ['d-2']);
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
    await expect(service.reserve(VARIANT, 1, AT, tx, ['d-2'])).rejects.toMatchObject({
      errorCode: ErrorCode.INSUFFICIENT_DEVICES,
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
