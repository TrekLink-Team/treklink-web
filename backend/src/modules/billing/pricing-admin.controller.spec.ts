import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { PricingAdminController } from './pricing-admin.controller';
import { PricingService } from './pricing.service';

const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const RATE = {
  id: 'dr-1',
  code: 'ANTENNA_BROKEN',
  label: 'Antenna broken',
  hardwareVariantId: null,
  amountVnd: 300_000n,
  isActive: true,
};

// billing api-design 03 to 07.
describe('PricingAdminController', () => {
  let pricing: Record<string, jest.Mock>;
  let controller: PricingAdminController;

  beforeEach(() => {
    pricing = {
      history: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'ps-1',
            hardwareVariantId: 'v-3',
            monthlyPriceVnd: 450_000n,
            effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
            createdAt: new Date('2026-10-01T00:00:00.000Z'),
            createdBy: { id: 'u-admin', fullName: 'Demo Admin' },
          },
        ],
        pageNumber: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
      }),
      setPrice: jest.fn().mockResolvedValue({
        id: 'ps-2',
        hardwareVariantId: 'v-3',
        monthlyPriceVnd: 480_000n,
        effectiveFrom: new Date('2026-11-01T00:00:00.000Z'),
        createdById: 'u-admin',
        createdAt: new Date('2026-10-27T00:00:00.000Z'),
      }),
      damageRates: jest.fn().mockResolvedValue([RATE]),
      createDamageRate: jest.fn().mockResolvedValue(RATE),
      updateDamageRate: jest.fn().mockResolvedValue({ ...RATE, amountVnd: 350_000n }),
    };
    controller = new PricingAdminController(pricing as unknown as PricingService);
  });

  it('answers the price history with VND numbers and the setter name', async () => {
    const page = await controller.history({ hardwareVariantId: 'v-3' });
    expect(pricing.history).toHaveBeenCalledWith('v-3', { hardwareVariantId: 'v-3' });
    expect(page.items[0]).toMatchObject({ monthlyPriceVnd: 450_000, createdBy: 'Demo Admin' });
  });

  it('schedules a price as a bigint at the given instant', async () => {
    const view = await controller.setPrice(
      { hardwareVariantId: 'v-3', monthlyPriceVnd: 480_000, effectiveFrom: '2026-11-01T00:00:00Z' },
      ADMIN,
    );
    expect(pricing.setPrice).toHaveBeenCalledWith(
      {
        hardwareVariantId: 'v-3',
        monthlyPriceVnd: 480_000n,
        effectiveFrom: new Date('2026-11-01T00:00:00Z'),
      },
      ADMIN,
    );
    expect(view).not.toHaveProperty('createdById');
  });

  it('creates a generic damage rate when no variant is given, and patches only what changed', async () => {
    await controller.createDamageRate(
      { code: 'ANTENNA_BROKEN', label: ' Antenna broken ', amountVnd: 300_000 },
      ADMIN,
    );
    expect(pricing.createDamageRate).toHaveBeenCalledWith(
      {
        code: 'ANTENNA_BROKEN',
        label: 'Antenna broken',
        hardwareVariantId: null,
        amountVnd: 300_000n,
      },
      ADMIN,
    );
    const view = await controller.updateDamageRate('dr-1', { amountVnd: 350_000 }, ADMIN);
    expect(pricing.updateDamageRate).toHaveBeenCalledWith('dr-1', { amountVnd: 350_000n }, ADMIN);
    expect(view.amountVnd).toBe(350_000);
  });

  const policiesOf = (method: string): PolicyHandler[] =>
    Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      Object.getOwnPropertyDescriptor(PricingAdminController.prototype, method)?.value as object,
    ) as PolicyHandler[];

  it.each([
    ['history', 'manage', 'PriceSchedule'],
    ['setPrice', 'manage', 'PriceSchedule'],
    ['damageRates', 'read', 'DamageRate'],
    ['createDamageRate', 'manage', 'DamageRate'],
    ['updateDamageRate', 'manage', 'DamageRate'],
  ])('checks %s against %s on %s', (method, action, subject) => {
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    expect(policiesOf(method).every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith(action, subject);
  });
});
