import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const PRICE_SELECT = {
  id: true,
  hardwareVariantId: true,
  monthlyPriceVnd: true,
  effectiveFrom: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.PriceScheduleSelect;

export type PriceRow = Prisma.PriceScheduleGetPayload<{ select: typeof PRICE_SELECT }>;

export const DAMAGE_RATE_SELECT = {
  id: true,
  code: true,
  label: true,
  hardwareVariantId: true,
  amountVnd: true,
  isActive: true,
} satisfies Prisma.DamageRateSelect;

export type DamageRateRow = Prisma.DamageRateGetPayload<{ select: typeof DAMAGE_RATE_SELECT }>;

export interface NewPrice {
  hardwareVariantId: string;
  monthlyPriceVnd: bigint;
  effectiveFrom: Date;
  createdById: string;
}

export interface NewDamageRate {
  code: string;
  label: string;
  hardwareVariantId: string | null;
  amountVnd: bigint;
  createdById: string;
}

export interface DamageRatePatch {
  label?: string;
  amountVnd?: bigint;
  isActive?: boolean;
}

// The only class of `billing` that touches PriceSchedule and DamageRate (D-044 rule 4, billing
// task 2.1). A price row is never updated: the table is append-only.
@Injectable()
export class PricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  insertPrice(price: NewPrice, client: Client = this.prisma): Promise<PriceRow> {
    return client.priceSchedule.create({ data: price, select: PRICE_SELECT });
  }

  // The latest row in effect at `at`; a row effective later is ignored.
  currentPrice(
    variantId: string,
    at: Date,
    client: Client = this.prisma,
  ): Promise<PriceRow | null> {
    return client.priceSchedule.findFirst({
      where: { hardwareVariantId: variantId, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
      select: PRICE_SELECT,
    });
  }

  // The row in effect at `at` for every variant that has one.
  currentPrices(at: Date): Promise<PriceRow[]> {
    return this.prisma.priceSchedule.findMany({
      where: { effectiveFrom: { lte: at } },
      orderBy: [{ hardwareVariantId: 'asc' }, { effectiveFrom: 'desc' }],
      distinct: ['hardwareVariantId'],
      select: PRICE_SELECT,
    });
  }

  pricePage(
    variantId: string | undefined,
    skip: number,
    take: number,
  ): Promise<[PriceRow[], number]> {
    const where = variantId ? { hardwareVariantId: variantId } : {};
    return this.prisma.$transaction([
      this.prisma.priceSchedule.findMany({
        where,
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        select: PRICE_SELECT,
      }),
      this.prisma.priceSchedule.count({ where }),
    ]);
  }

  // Every rate, or the generic rates plus those of one variant.
  damageRates(variantId?: string): Promise<DamageRateRow[]> {
    return this.prisma.damageRate.findMany({
      where: variantId
        ? { OR: [{ hardwareVariantId: null }, { hardwareVariantId: variantId }] }
        : {},
      orderBy: [{ code: 'asc' }, { hardwareVariantId: { sort: 'asc', nulls: 'first' } }],
      select: DAMAGE_RATE_SELECT,
    });
  }

  // The active rates of a code that apply to a variant: its own and the generic one.
  activeRates(
    code: string,
    variantId: string,
    client: Client = this.prisma,
  ): Promise<DamageRateRow[]> {
    return client.damageRate.findMany({
      where: {
        code,
        isActive: true,
        OR: [{ hardwareVariantId: null }, { hardwareVariantId: variantId }],
      },
      select: DAMAGE_RATE_SELECT,
    });
  }

  insertDamageRate(rate: NewDamageRate, client: Client = this.prisma): Promise<DamageRateRow> {
    return client.damageRate.create({ data: rate, select: DAMAGE_RATE_SELECT });
  }

  findDamageRate(id: string, client: Client = this.prisma): Promise<DamageRateRow | null> {
    return client.damageRate.findUnique({ where: { id }, select: DAMAGE_RATE_SELECT });
  }

  updateDamageRate(
    id: string,
    patch: DamageRatePatch,
    client: Client = this.prisma,
  ): Promise<DamageRateRow> {
    return client.damageRate.update({ where: { id }, data: patch, select: DAMAGE_RATE_SELECT });
  }
}
