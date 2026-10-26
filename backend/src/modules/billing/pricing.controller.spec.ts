import { PlanType } from '@prisma/client';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { DevicesService } from '../devices';
import { PricingController, toQuoteView } from './pricing.controller';
import { PricingService } from './pricing.service';

const V2 = { id: 'v-2', code: 'treklink-v2', name: 'TrekLink v2', isActive: true };
const V3 = { id: 'v-3', code: 'treklink-v3', name: 'TrekLink v3', isActive: true };

describe('PricingController (billing api-design 01 and 02)', () => {
  let pricing: { catalogue: jest.Mock; quote: jest.Mock };
  let devices: { variants: jest.Mock };
  let controller: PricingController;

  beforeEach(() => {
    pricing = {
      catalogue: jest.fn().mockResolvedValue({
        minOrderQuantity: 5,
        holdingFeeRatio: 0.5,
        dayPlanLengths: [3, 4, 7],
        dayPremium: 1.5,
        prices: [{ hardwareVariantId: 'v-3', monthlyPriceVnd: 450_000n, dayPriceVnd: 22_500n }],
      }),
      quote: jest.fn().mockResolvedValue({
        planType: PlanType.MONTHLY,
        quantity: 10,
        termFeeVnd: 4_500_000n,
        firstPaymentVnd: 2_250_000n,
        formula: '450000 x 10 x 0.5',
      }),
    };
    devices = { variants: jest.fn().mockResolvedValue([V2, V3]) };
    controller = new PricingController(
      pricing as unknown as PricingService,
      devices as unknown as DevicesService,
    );
  });

  it('lists the active variants that have a price, with numbers for amounts', async () => {
    await expect(controller.plans()).resolves.toEqual({
      minOrderQuantity: 5,
      holdingFeeRatio: 0.5,
      dayPlanLengths: [3, 4, 7],
      dayPremium: 1.5,
      variants: [
        {
          id: 'v-3',
          code: 'treklink-v3',
          name: 'TrekLink v3',
          monthlyPriceVnd: 450_000,
          dayPriceVnd: 22_500,
        },
      ],
      sandbox: true,
    });
    expect(devices.variants).toHaveBeenCalledWith(true);
  });

  it('answers a quote with plain numbers', async () => {
    const dto = { planType: PlanType.MONTHLY, hardwareVariantId: 'v-3', quantity: 10 };
    await expect(controller.quote(dto)).resolves.toEqual({
      planType: PlanType.MONTHLY,
      quantity: 10,
      termFeeVnd: 4_500_000,
      firstPaymentVnd: 2_250_000,
      formula: '450000 x 10 x 0.5',
    });
    expect(pricing.quote).toHaveBeenCalledWith(dto);
  });

  it('keeps the non-amount fields of a day-plan quote as they are', () => {
    expect(
      toQuoteView({
        planType: PlanType.DAY,
        quantity: 8,
        unitPerDayVnd: 22_500n,
        days: 4,
        totalVnd: 720_000n,
        firstPaymentVnd: 720_000n,
        formula: '450000 / 30 x 1.5 x 4 x 8',
      }),
    ).toEqual({
      planType: PlanType.DAY,
      quantity: 8,
      unitPerDayVnd: 22_500,
      days: 4,
      totalVnd: 720_000,
      firstPaymentVnd: 720_000,
      formula: '450000 / 30 x 1.5 x 4 x 8',
    });
  });

  it('checks the plan.quote permission on quotes', () => {
    const handlers = Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      Object.getOwnPropertyDescriptor(PricingController.prototype, 'quote')?.value as object,
    ) as PolicyHandler[];
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    expect(handlers.every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith('quote', 'Plan');
  });
});
