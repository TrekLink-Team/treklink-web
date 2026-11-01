import type { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesRepository } from './devices.repository';

// The projection keeps the time of the reading that set its position (devices design §1, monitoring
// REQ-UBI-04, D-092 rule 2), because a reading without a position moves `lastSeenAt` only.
describe('DevicesRepository.projectIfNewer', () => {
  const at = new Date('2026-11-01T03:00:00.000Z');
  let updateMany: jest.Mock;
  let repository: DevicesRepository;

  beforeEach(() => {
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    repository = new DevicesRepository({ device: { updateMany } } as unknown as PrismaService);
  });

  it('stores the fix time with a position', async () => {
    await expect(
      repository.projectIfNewer('d-1', { at, latitude: 11.5, longitude: 108.5, batteryPct: 80 }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'd-1', OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: at } }] },
      data: {
        lastSeenAt: at,
        lastLatitude: 11.5,
        lastLongitude: 108.5,
        lastPositionAt: at,
        batteryPct: 80,
        lastBatteryAt: at,
      },
    });
  });

  it('leaves the position and its time alone on a reading without one', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.projectIfNewer('d-1', { at, batteryPct: 70 })).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastSeenAt: at, batteryPct: 70, lastBatteryAt: at } }),
    );
  });

  it('leaves the battery and its time alone on a reading without one', async () => {
    await repository.projectIfNewer('d-1', { at, latitude: 11.5, longitude: 108.5 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastSeenAt: at, lastLatitude: 11.5, lastLongitude: 108.5, lastPositionAt: at },
      }),
    );
  });
});
