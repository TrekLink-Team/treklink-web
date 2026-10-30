import { Prisma } from '@prisma/client';
import { DevicesRepository, PROVISIONED_SELECT } from './devices.repository';
import { DevicesService } from './devices.service';

// Undoing a provisioning record before the handover (rentals api-design 19, devices REQ-EVT-04): the
// unit carries no organization key version again, and the append-only DeviceProvisioning row stays.
describe('clearProvisioning', () => {
  const cleared = {
    id: 'dev-1',
    assetTag: 'TL-0001',
    status: 'RESERVED',
    keyVersion: null,
    keyOrganizationId: null,
    provisionedAt: null,
    batteryPct: null,
  };

  it('clears the key version, key organization and provisioning time and bumps the version', async () => {
    const tx = {
      device: { update: jest.fn().mockResolvedValue(cleared) },
      deviceProvisioning: { create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    };
    const repository = new DevicesRepository({} as never);

    await expect(
      repository.clearProvisioning('dev-1', tx as unknown as Prisma.TransactionClient),
    ).resolves.toEqual(cleared);
    expect(tx.device.update).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
      data: {
        keyVersion: null,
        keyOrganizationId: null,
        provisionedAt: null,
        version: { increment: 1 },
      },
      select: PROVISIONED_SELECT,
    });
    expect(tx.deviceProvisioning.delete).not.toHaveBeenCalled();
    expect(tx.deviceProvisioning.deleteMany).not.toHaveBeenCalled();
  });

  it('is served to rentals through DevicesService in the caller transaction', async () => {
    const tx = {} as Prisma.TransactionClient;
    const repository = { clearProvisioning: jest.fn().mockResolvedValue(cleared) };
    const service = new DevicesService(
      repository as unknown as DevicesRepository,
      {} as never,
      {} as never,
    );

    await expect(service.clearProvisioning('dev-1', tx)).resolves.toEqual(cleared);
    expect(repository.clearProvisioning).toHaveBeenCalledWith('dev-1', tx);
  });
});
