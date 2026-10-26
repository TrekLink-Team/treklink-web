import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DAMAGE_RATE_SELECT, PRICE_SELECT, PricingRepository } from './pricing.repository';

const AT = new Date('2026-10-26T03:00:00.000Z');

describe('PricingRepository (billing task 2.1)', () => {
  let prisma: {
    priceSchedule: Record<string, jest.Mock>;
    damageRate: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let repository: PricingRepository;
  const tx = () => prisma as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    prisma = {
      priceSchedule: {
        create: jest.fn().mockResolvedValue({ id: 'ps-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      damageRate: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'dr-1' }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'dr-1' }),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    repository = new PricingRepository(prisma as unknown as PrismaService);
  });

  it('appends a price row', async () => {
    const price = {
      hardwareVariantId: 'v-1',
      monthlyPriceVnd: 450_000n,
      effectiveFrom: AT,
      createdById: 'admin-1',
    };
    await repository.insertPrice(price, tx());
    expect(prisma.priceSchedule.create).toHaveBeenCalledWith({ data: price, select: PRICE_SELECT });
  });

  it('reads the latest price in effect at a time, ignoring later rows', async () => {
    await repository.currentPrice('v-1', AT);
    expect(prisma.priceSchedule.findFirst).toHaveBeenCalledWith({
      where: { hardwareVariantId: 'v-1', effectiveFrom: { lte: AT } },
      orderBy: { effectiveFrom: 'desc' },
      select: PRICE_SELECT,
    });
  });

  it('reads one current price per variant', async () => {
    await repository.currentPrices(AT);
    expect(prisma.priceSchedule.findMany).toHaveBeenCalledWith({
      where: { effectiveFrom: { lte: AT } },
      orderBy: [{ hardwareVariantId: 'asc' }, { effectiveFrom: 'desc' }],
      distinct: ['hardwareVariantId'],
      select: PRICE_SELECT,
    });
  });

  it('pages the schedule, of every variant or one', async () => {
    prisma.priceSchedule.findMany.mockResolvedValue([{ id: 'ps-1' }]);
    prisma.priceSchedule.count.mockResolvedValue(1);

    await expect(repository.pricePage(undefined, 0, 20)).resolves.toEqual([[{ id: 'ps-1' }], 1]);
    expect(prisma.priceSchedule.count).toHaveBeenLastCalledWith({ where: {} });

    await repository.pricePage('v-1', 20, 20);
    expect(prisma.priceSchedule.findMany).toHaveBeenLastCalledWith({
      where: { hardwareVariantId: 'v-1' },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      skip: 20,
      take: 20,
      select: PRICE_SELECT,
    });
  });

  it('lists every damage rate, or the generic ones and those of a variant', async () => {
    await repository.damageRates();
    expect(prisma.damageRate.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: {}, select: DAMAGE_RATE_SELECT }),
    );

    await repository.damageRates('v-1');
    expect(prisma.damageRate.findMany).toHaveBeenLastCalledWith({
      where: { OR: [{ hardwareVariantId: null }, { hardwareVariantId: 'v-1' }] },
      orderBy: [{ code: 'asc' }, { hardwareVariantId: { sort: 'asc', nulls: 'first' } }],
      select: DAMAGE_RATE_SELECT,
    });
  });

  it('reads the active rates of a code for a variant and the generic one', async () => {
    await repository.activeRates('ANTENNA_BROKEN', 'v-1', tx());
    expect(prisma.damageRate.findMany).toHaveBeenCalledWith({
      where: {
        code: 'ANTENNA_BROKEN',
        isActive: true,
        OR: [{ hardwareVariantId: null }, { hardwareVariantId: 'v-1' }],
      },
      select: DAMAGE_RATE_SELECT,
    });
  });

  it('inserts, finds and updates a damage rate', async () => {
    const rate = {
      code: 'CASING_CRACKED',
      label: 'Casing cracked',
      hardwareVariantId: null,
      amountVnd: 400_000n,
      createdById: 'admin-1',
    };
    await repository.insertDamageRate(rate);
    expect(prisma.damageRate.create).toHaveBeenCalledWith({
      data: rate,
      select: DAMAGE_RATE_SELECT,
    });

    await repository.findDamageRate('dr-1');
    expect(prisma.damageRate.findUnique).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      select: DAMAGE_RATE_SELECT,
    });

    await repository.updateDamageRate('dr-1', { amountVnd: 350_000n }, tx());
    expect(prisma.damageRate.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: { amountVnd: 350_000n },
      select: DAMAGE_RATE_SELECT,
    });
  });

  it('uses the shared client when no transaction is passed', async () => {
    await repository.insertPrice({
      hardwareVariantId: 'v-1',
      monthlyPriceVnd: 1n,
      effectiveFrom: AT,
      createdById: 'admin-1',
    });
    await repository.activeRates('ANTENNA_BROKEN', 'v-1');
    await repository.updateDamageRate('dr-1', { isActive: false });
    expect(prisma.priceSchedule.create).toHaveBeenCalledTimes(1);
    expect(prisma.damageRate.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.damageRate.update).toHaveBeenCalledTimes(1);
  });
});
