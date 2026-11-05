import { DevicesService } from './devices.service';
import { VariantsController } from './variants.controller';
import { VariantsService } from './variants.service';

const V3 = { id: 'v-3', code: 'treklink-v3', isActive: true };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };

describe('VariantsController (devices api-design 01 to 04, tasks 2.1 and 4.1)', () => {
  let devices: { variantCatalog: jest.Mock };
  let variants: { create: jest.Mock; update: jest.Mock; remove: jest.Mock };
  let controller: VariantsController;

  beforeEach(() => {
    devices = { variantCatalog: jest.fn().mockResolvedValue([V3]) };
    variants = {
      create: jest.fn().mockResolvedValue(V3),
      update: jest.fn().mockResolvedValue(V3),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    controller = new VariantsController(
      devices as unknown as DevicesService,
      variants as unknown as VariantsService,
    );
  });

  it('lists active variants only by default', async () => {
    await expect(
      controller.list({}, { id: 'u', roles: ['STAFF'], organizationId: null }),
    ).resolves.toEqual([V3]);
    expect(devices.variantCatalog).toHaveBeenCalledWith(true);
  });

  it('lists every variant for an Admin who asks for inactive ones too', async () => {
    await controller.list({ includeInactive: true }, ADMIN);
    expect(devices.variantCatalog).toHaveBeenCalledWith(false);
  });

  it('ignores includeInactive for a non-Admin caller', async () => {
    await controller.list(
      { includeInactive: true },
      { id: 'u', roles: ['STAFF'], organizationId: null },
    );
    expect(devices.variantCatalog).toHaveBeenCalledWith(true);
  });

  it('passes create, edit and delete to the service with the caller', async () => {
    const dto = { code: 'treklink-v5' } as never;
    await expect(controller.create(dto, ADMIN)).resolves.toEqual(V3);
    expect(variants.create).toHaveBeenCalledWith(dto, ADMIN);

    const patch = { name: 'v3', expectedVersion: 2 } as never;
    await controller.update('v-3', patch, ADMIN);
    expect(variants.update).toHaveBeenCalledWith('v-3', patch, ADMIN);

    await expect(controller.remove('v-3', ADMIN)).resolves.toBeNull();
    expect(variants.remove).toHaveBeenCalledWith('v-3', ADMIN);
  });
});
