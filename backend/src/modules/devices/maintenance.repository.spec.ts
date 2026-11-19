import { DeviceStatus } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { MaintenanceRepository } from './maintenance.repository';

describe('MaintenanceRepository.dueDevices (REQ-EVT-19)', () => {
  const dueBefore = new Date('2026-11-28T00:00:00.000Z');

  it('selects the three contract-safe states and keeps only service or firmware due devices', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'd-due',
        assetTag: 'TL-0001',
        status: DeviceStatus.AVAILABLE,
        serviceDueAt: new Date('2026-11-27T00:00:00.000Z'),
        firmwareVersion: 'a',
        hardwareVariant: { firmwareBaseline: 'a' },
      },
      {
        id: 'd-boundary',
        assetTag: 'TL-0002',
        status: DeviceStatus.AVAILABLE,
        serviceDueAt: dueBefore,
        firmwareVersion: 'a',
        hardwareVariant: { firmwareBaseline: 'a' },
      },
      {
        id: 'd-firmware',
        assetTag: 'TL-0003',
        status: DeviceStatus.RENTED,
        serviceDueAt: null,
        firmwareVersion: 'old',
        hardwareVariant: { firmwareBaseline: 'current' },
      },
      {
        id: 'd-later',
        assetTag: 'TL-0004',
        status: DeviceStatus.RESERVED,
        serviceDueAt: new Date('2026-12-01T00:00:00.000Z'),
        firmwareVersion: 'a',
        hardwareVariant: { firmwareBaseline: 'a' },
      },
    ]);
    const repository = new MaintenanceRepository({
      device: { findMany },
    } as unknown as PrismaService);

    await expect(repository.dueDevices(dueBefore)).resolves.toEqual([
      expect.objectContaining({ id: 'd-due', firmwareBaseline: 'a' }),
      expect.objectContaining({ id: 'd-firmware', firmwareBaseline: 'current' }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: [DeviceStatus.AVAILABLE, DeviceStatus.RESERVED, DeviceStatus.RENTED],
          },
        },
        orderBy: { assetTag: 'asc' },
      }),
    );
  });
});
