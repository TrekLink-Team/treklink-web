import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { AccountDirectory } from '../platform/ports/account-directory.port';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

const NOW = new Date('2026-10-26T03:00:00.000Z');
const tx = { tx: true } as unknown as Prisma.TransactionClient;
const ADMIN = { id: 'admin-1', roles: ['TREKLINK_ADMIN'] } as unknown as Caller;
const PRICE = {
  id: 'ps-1',
  hardwareVariantId: 'v-3',
  monthlyPriceVnd: 450_000n,
  effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
  createdById: 'admin-1',
  createdAt: NOW,
};
const PARAMETERS: Record<string, unknown> = {
  'billing.dayPremium': 1.5,
  'billing.holdingFeeRatio': 0.5,
  'rentals.minOrderQuantity': 5,
  'rentals.dayPlanLengths': [3, 4, 7],
};
const rate = (id: string, hardwareVariantId: string | null, amountVnd: bigint) => ({
  id,
  code: 'ANTENNA_BROKEN',
  label: 'Antenna broken',
  hardwareVariantId,
  amountVnd,
  isActive: true,
});
const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test' });

describe('PricingService (billing task 2.1)', () => {
  let pricing: Record<string, jest.Mock>;
  let parameters: { get: jest.Mock };
  let emitter: { emit: jest.Mock };
  let prisma: { $transaction: jest.Mock };
  let directory: { namesOf: jest.Mock };
  let service: PricingService;

  const build = (accounts?: AccountDirectory) =>
    new PricingService(
      pricing as unknown as PricingRepository,
      parameters as unknown as ParameterService,
      new TransactionalEvents(
        prisma as unknown as PrismaService,
        emitter as unknown as EventEmitter2,
      ),
      {
        get: (key: string) => ({ DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 })[key],
      } as unknown as ConfigService<ValidatedEnvironment, true>,
      accounts,
    );

  const audits = (): unknown[] =>
    (emitter.emit.mock.calls as [string, unknown][])
      .filter(([event]) => event === AUDIT_RECORD)
      .map(([, payload]) => payload);

  beforeEach(() => {
    pricing = {
      currentPrice: jest.fn().mockResolvedValue(PRICE),
      currentPrices: jest.fn().mockResolvedValue([PRICE]),
      insertPrice: jest.fn().mockResolvedValue(PRICE),
      pricePage: jest.fn().mockResolvedValue([[PRICE], 1]),
      currentPriceIds: jest.fn().mockResolvedValue(new Set(['ps-1'])),
      damageRates: jest.fn().mockResolvedValue([]),
      activeRates: jest.fn().mockResolvedValue([]),
      activeRatesOfVariant: jest.fn().mockResolvedValue([]),
      insertDamageRate: jest.fn().mockResolvedValue(rate('dr-1', null, 300_000n)),
      findDamageRate: jest.fn().mockResolvedValue(rate('dr-1', null, 300_000n)),
      updateDamageRate: jest.fn().mockResolvedValue(rate('dr-1', null, 350_000n)),
    };
    parameters = { get: jest.fn((key: string) => Promise.resolve(PARAMETERS[key])) };
    emitter = { emit: jest.fn() };
    prisma = {
      $transaction: jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx),
      ),
    };
    directory = { namesOf: jest.fn().mockResolvedValue(new Map([['admin-1', 'Tran Admin']])) };
    service = build(directory);
  });

  describe('snapshot (FR-CFG-02)', () => {
    it('keeps the price in effect and the plan parameters, read in the caller transaction', async () => {
      const snapshot = await service.snapshot('v-3', tx, NOW);

      expect(snapshot.monthlyUnitPriceVnd).toBe(450_000n);
      expect(snapshot.dayPremium.toString()).toBe('1.5');
      expect(snapshot.holdingFeeRatio.toString()).toBe('0.5');
      expect(pricing.currentPrice).toHaveBeenCalledWith('v-3', NOW, tx);
      expect(parameters.get).toHaveBeenCalledWith('billing.dayPremium', tx);
      expect(parameters.get).toHaveBeenCalledWith('billing.holdingFeeRatio', tx);
    });

    it('reads at the current time by default', async () => {
      await service.snapshot('v-3');
      expect(pricing.currentPrice).toHaveBeenCalledWith('v-3', expect.any(Date), undefined);
    });

    it('answers 404 for a variant with no price in effect', async () => {
      pricing.currentPrice.mockResolvedValue(null);
      await expect(service.snapshot('v-9', undefined, NOW)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('quote (api-design 02)', () => {
    it('prices a monthly plan: one term and the holding fee as the first payment', async () => {
      await expect(
        service.quote({ planType: PlanType.MONTHLY, hardwareVariantId: 'v-3', quantity: 10 }, NOW),
      ).resolves.toEqual({
        planType: PlanType.MONTHLY,
        quantity: 10,
        termFeeVnd: 4_500_000n,
        firstPaymentVnd: 2_250_000n,
        formula: '450000 x 10 x 0.5',
      });
      expect(pricing.currentPrice).toHaveBeenCalledWith('v-3', NOW, undefined);
    });

    it('prices a day plan, paid in full up front', async () => {
      await expect(
        service.quote({
          planType: PlanType.DAY,
          dayPlanDays: 4,
          hardwareVariantId: 'v-3',
          quantity: 8,
        }),
      ).resolves.toEqual({
        planType: PlanType.DAY,
        quantity: 8,
        unitPerDayVnd: 22_500n,
        days: 4,
        totalVnd: 720_000n,
        firstPaymentVnd: 720_000n,
        formula: '450000 / 30 x 1.5 x 4 x 8',
      });
    });

    it('refuses a quantity below the minimum order with BELOW_MOQ', async () => {
      await expect(
        service.quote({ planType: PlanType.MONTHLY, hardwareVariantId: 'v-3', quantity: 4 }),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.BELOW_MOQ,
        message: 'The minimum order is 5 devices.',
      });
      expect(pricing.currentPrice).not.toHaveBeenCalled();
    });

    it.each([[undefined], [5]])('refuses a day-plan length of %s', async (dayPlanDays) => {
      await expect(
        service.quote({
          planType: PlanType.DAY,
          dayPlanDays,
          hardwareVariantId: 'v-3',
          quantity: 8,
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: 'dayPlanDays must be one of 3, 4, 7.',
      });
    });

    it('treats a malformed day-plan parameter as no allowed length', async () => {
      PARAMETERS['rentals.dayPlanLengths'] = { days: [3] };
      try {
        await expect(
          service.quote({
            planType: PlanType.DAY,
            dayPlanDays: 3,
            hardwareVariantId: 'v-3',
            quantity: 8,
          }),
        ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
      } finally {
        PARAMETERS['rentals.dayPlanLengths'] = [3, 4, 7];
      }
    });
  });

  it('lists the catalogue: price in effect per variant, day price and plan parameters', async () => {
    await expect(service.catalogue(NOW)).resolves.toEqual({
      minOrderQuantity: 5,
      holdingFeeRatio: 0.5,
      dayPlanLengths: [3, 4, 7],
      dayPremium: 1.5,
      prices: [{ hardwareVariantId: 'v-3', monthlyPriceVnd: 450_000n, dayPriceVnd: 22_500n }],
    });
    expect(pricing.currentPrices).toHaveBeenCalledWith(NOW);
    await service.catalogue();
    expect(pricing.currentPrices).toHaveBeenLastCalledWith(expect.any(Date));
  });

  describe('setPrice (api-design 04)', () => {
    const input = {
      hardwareVariantId: 'v-3',
      monthlyPriceVnd: 480_000n,
      effectiveFrom: new Date('2026-11-01T00:00:00.000Z'),
    };

    it('appends the row and audits price.set after commit', async () => {
      await expect(service.setPrice(input, ADMIN, NOW)).resolves.toBe(PRICE);
      expect(pricing.insertPrice).toHaveBeenCalledWith({ ...input, createdById: 'admin-1' }, tx);
      expect(audits()).toEqual([
        {
          actorId: 'admin-1',
          actorRoles: ['TREKLINK_ADMIN'],
          organizationId: null,
          action: 'price.set',
          subjectType: 'PriceSchedule',
          subjectId: 'ps-1',
          after: {
            hardwareVariantId: 'v-3',
            monthlyPriceVnd: '450000',
            effectiveFrom: PRICE.effectiveFrom,
          },
        },
      ]);
    });

    it('accepts a price effective at this instant', async () => {
      await service.setPrice({ ...input, effectiveFrom: NOW }, ADMIN, NOW);
      expect(pricing.insertPrice).toHaveBeenCalled();
    });

    it('refuses a past effective time with EFFECTIVE_IN_PAST and stores nothing', async () => {
      await expect(
        service.setPrice({ ...input, effectiveFrom: new Date(NOW.getTime() - 1) }, ADMIN, NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.EFFECTIVE_IN_PAST });
      await expect(
        service.setPrice({ ...input, effectiveFrom: new Date('2020-01-01T00:00:00Z') }, ADMIN),
      ).rejects.toMatchObject({ errorCode: ErrorCode.EFFECTIVE_IN_PAST });
      expect(pricing.insertPrice).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown variant and rethrows anything else', async () => {
      pricing.insertPrice.mockRejectedValueOnce(prismaError('P2003'));
      await expect(service.setPrice(input, ADMIN, NOW)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
        message: 'Hardware variant not found.',
      });
      pricing.insertPrice.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.setPrice(input, ADMIN, NOW)).rejects.toThrow('connection lost');
      expect(audits()).toEqual([]);
    });
  });

  describe('history (api-design 03)', () => {
    it('pages the schedule with the name of who set each row', async () => {
      await expect(service.history('v-3', { pageNumber: 1, pageSize: 20 })).resolves.toEqual({
        items: [
          {
            id: 'ps-1',
            hardwareVariantId: 'v-3',
            monthlyPriceVnd: 450_000n,
            effectiveFrom: PRICE.effectiveFrom,
            createdAt: NOW,
            createdBy: { id: 'admin-1', fullName: 'Tran Admin' },
            state: 'CURRENT',
          },
        ],
        pageNumber: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
      });
      expect(pricing.pricePage).toHaveBeenCalledWith('v-3', 0, 20);
    });

    it('labels every row against the whole schedule, so an old page shows no second Current (review of #91)', async () => {
      const LATER = new Date(PRICE.effectiveFrom.getTime() + 86_400_000);
      pricing.pricePage.mockResolvedValueOnce([
        [
          { ...PRICE, id: 'ps-9', effectiveFrom: LATER },
          { ...PRICE, id: 'ps-2' },
        ],
        3,
      ]);
      pricing.currentPriceIds.mockResolvedValueOnce(new Set(['ps-1']));
      const page = await service.history('v-3', { pageNumber: 2, pageSize: 2 }, LATER);
      // ps-9 starts exactly now: in effect, but ps-1 on page 1 is the current row of the schedule.
      expect(page.items.map((item) => [item.id, item.state])).toEqual([
        ['ps-9', 'PAST'],
        ['ps-2', 'PAST'],
      ]);
      expect(pricing.currentPriceIds).toHaveBeenCalledWith(LATER);
    });

    it('marks a row that starts after now as UPCOMING', async () => {
      const AFTER = new Date(PRICE.effectiveFrom.getTime() - 1);
      const page = await service.history('v-3', {}, AFTER);
      expect(page.items[0].state).toBe('UPCOMING');
    });

    it('leaves the name null without an account directory', async () => {
      const page = await build().history(undefined, {});
      expect(page.items[0].createdBy).toEqual({ id: 'admin-1', fullName: null });
    });
  });

  describe('damage rates (api-design 05 to 07)', () => {
    it('lists the rates through the repository', async () => {
      await service.damageRates('v-3');
      expect(pricing.damageRates).toHaveBeenCalledWith('v-3');
    });

    it('creates a rate, 404 for an unknown variant, other errors rethrown', async () => {
      const input = {
        code: 'CASING_CRACKED',
        label: 'Casing cracked',
        hardwareVariantId: null,
        amountVnd: 400_000n,
      };
      await service.createDamageRate(input, ADMIN);
      expect(pricing.insertDamageRate).toHaveBeenCalledWith({ ...input, createdById: 'admin-1' });

      pricing.insertDamageRate.mockRejectedValueOnce(prismaError('P2003'));
      await expect(service.createDamageRate(input, ADMIN)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      const duplicate = prismaError('P2002');
      pricing.insertDamageRate.mockRejectedValueOnce(duplicate);
      await expect(service.createDamageRate(input, ADMIN)).rejects.toBe(duplicate);
    });

    it('updates a rate and audits the change after commit', async () => {
      await expect(
        service.updateDamageRate('dr-1', { amountVnd: 350_000n }, ADMIN),
      ).resolves.toMatchObject({ amountVnd: 350_000n });
      expect(pricing.updateDamageRate).toHaveBeenCalledWith('dr-1', { amountVnd: 350_000n }, tx);
      expect(audits()).toEqual([
        expect.objectContaining({
          action: 'damageRate.update',
          subjectType: 'DamageRate',
          subjectId: 'dr-1',
          organizationId: null,
          before: { label: 'Antenna broken', amountVnd: '300000', isActive: true },
          after: { label: 'Antenna broken', amountVnd: '350000', isActive: true },
        }),
      ]);
    });

    it('answers 404 for an unknown rate', async () => {
      pricing.findDamageRate.mockResolvedValue(null);
      await expect(
        service.updateDamageRate('dr-9', { isActive: false }, ADMIN),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
        message: 'Damage rate not found.',
      });
      expect(pricing.updateDamageRate).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the variant rate over the generic one',
        [rate('g', null, 300_000n), rate('own', 'v-3', 500_000n)],
        500_000n,
      ],
      ['the generic rate as fallback', [rate('g', null, 300_000n)], 300_000n],
      ['null when no active rate applies', [], null],
    ])('picks %s', async (_label, rows, expected) => {
      pricing.activeRates.mockResolvedValue(rows);
      await expect(service.damageRateFor('ANTENNA_BROKEN', 'v-3', tx)).resolves.toBe(expected);
      expect(pricing.activeRates).toHaveBeenCalledWith('ANTENNA_BROKEN', 'v-3', tx);
    });

    it('builds the rate table of a variant: one row per code, its own rate over the generic one', async () => {
      pricing.activeRatesOfVariant.mockResolvedValue([
        { ...rate('g-1', null, 300_000n), code: 'CASING_CRACKED', label: 'Casing cracked' },
        rate('g-2', null, 200_000n),
        rate('own', 'v-3', 500_000n),
      ]);
      await expect(service.rateTableFor('v-3', tx)).resolves.toEqual([
        { code: 'ANTENNA_BROKEN', label: 'Antenna broken', amountVnd: 500_000n },
        { code: 'CASING_CRACKED', label: 'Casing cracked', amountVnd: 300_000n },
      ]);
      expect(pricing.activeRatesOfVariant).toHaveBeenCalledWith('v-3', tx);
    });
  });
});
