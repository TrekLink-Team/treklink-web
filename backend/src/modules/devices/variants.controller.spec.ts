import { DevicesService } from './devices.service';
import { VariantsController } from './variants.controller';

const V3 = { id: 'v-3', code: 'treklink-v3', isActive: true };

describe('VariantsController (devices api-design 01, task 4.1 part)', () => {
  let devices: { variantCatalog: jest.Mock };
  let controller: VariantsController;

  beforeEach(() => {
    devices = { variantCatalog: jest.fn().mockResolvedValue([V3]) };
    controller = new VariantsController(devices as unknown as DevicesService);
  });

  it('lists active variants only by default', async () => {
    await expect(
      controller.list({}, { id: 'u', roles: ['STAFF'], organizationId: null }),
    ).resolves.toEqual([V3]);
    expect(devices.variantCatalog).toHaveBeenCalledWith(true);
  });

  it('lists every variant for an Admin who asks for inactive ones too', async () => {
    await controller.list(
      { includeInactive: true },
      { id: 'u', roles: ['ADMIN'], organizationId: null },
    );
    expect(devices.variantCatalog).toHaveBeenCalledWith(false);
  });

  it('ignores includeInactive for a non-Admin caller', async () => {
    await controller.list(
      { includeInactive: true },
      { id: 'u', roles: ['STAFF'], organizationId: null },
    );
    expect(devices.variantCatalog).toHaveBeenCalledWith(true);
  });
});
