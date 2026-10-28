import { DeviceStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

const AT = new Date('2026-11-10T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;

const unit = (overrides: Record<string, unknown> = {}) => ({
  id: 'd-9',
  assetTag: 'TL-0009',
  hardwareVariantId: 'v-3',
  status: DeviceStatus.AVAILABLE,
  ...overrides,
});

// The device side of rentals 4.3 and the fleet list of devices api-design 06, built by LongLP.
describe('DevicesService for the replacement on a running contract', () => {
  let repository: Record<string, jest.Mock>;
  let service: DevicesService;

  beforeEach(() => {
    repository = {
      lockUnit: jest.fn().mockResolvedValue(unit()),
      moveStatus: jest.fn().mockResolvedValue(1),
      hasOpenLossCase: jest.fn().mockResolvedValue(true),
      page: jest.fn().mockResolvedValue([[], 0]),
    };
    service = new DevicesService(repository as unknown as DevicesRepository);
  });

  it('locks an AVAILABLE unit of the variant and moves it to RESERVED', async () => {
    await expect(service.takeForReplacement('d-9', 'v-3', AT, TX)).resolves.toEqual({
      id: 'd-9',
      assetTag: 'TL-0009',
    });
    expect(repository.lockUnit).toHaveBeenCalledWith('d-9', TX);
    expect(repository.moveStatus).toHaveBeenCalledWith(
      ['d-9'],
      DeviceStatus.AVAILABLE,
      DeviceStatus.RESERVED,
      AT,
      TX,
    );
  });

  it('refuses another variant with 409 VARIANT_MISMATCH', async () => {
    repository.lockUnit.mockResolvedValue(unit({ hardwareVariantId: 'v-4' }));
    await expect(service.takeForReplacement('d-9', 'v-3', AT, TX)).rejects.toMatchObject({
      errorCode: ErrorCode.VARIANT_MISMATCH,
      message: 'Choose a unit of the same variant.',
    });
    expect(repository.moveStatus).not.toHaveBeenCalled();
  });

  it.each([DeviceStatus.RESERVED, DeviceStatus.RENTED, DeviceStatus.MAINTENANCE])(
    'refuses a %s unit with 409 DEVICE_NOT_AVAILABLE',
    async (status) => {
      repository.lockUnit.mockResolvedValue(unit({ status }));
      await expect(service.takeForReplacement('d-9', 'v-3', AT, TX)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_AVAILABLE,
      });
    },
  );

  it('answers 404 for an unknown unit', async () => {
    repository.lockUnit.mockResolvedValue(null);
    await expect(service.takeForReplacement('d-0', 'v-3', AT, TX)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });

  it('passes the list filter and the page through to the repository', async () => {
    await service.page({ statuses: [DeviceStatus.AVAILABLE], hardwareVariantId: 'v-3' }, 0, 20);
    expect(repository.page).toHaveBeenCalledWith(
      { statuses: [DeviceStatus.AVAILABLE], hardwareVariantId: 'v-3' },
      0,
      20,
    );
  });
});
