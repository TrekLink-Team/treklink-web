import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../platform/ports/account-directory.port';
import { ActorRef, resolveActors } from '../platform/ports/actor-names';
import { dayPlanFeeVnd, holdingFeeVnd, termFeeVnd } from './money';
import { DamageRatePatch, DamageRateRow, PriceRow, PricingRepository } from './pricing.repository';

// The prices a contract keeps from its request onwards (FR-CFG-02): later price or parameter
// changes never reach it.
export interface PriceSnapshot {
  monthlyUnitPriceVnd: bigint;
  dayPremium: Prisma.Decimal;
  holdingFeeRatio: Prisma.Decimal;
}

export interface QuoteInput {
  planType: PlanType;
  dayPlanDays?: number;
  hardwareVariantId: string;
  quantity: number;
}

// api-design 02: the MONTHLY fields or the DAY fields, never both.
export type Quote =
  | {
      planType: typeof PlanType.MONTHLY;
      quantity: number;
      termFeeVnd: bigint;
      firstPaymentVnd: bigint;
      formula: string;
    }
  | {
      planType: typeof PlanType.DAY;
      quantity: number;
      unitPerDayVnd: bigint;
      days: number;
      totalVnd: bigint;
      firstPaymentVnd: bigint;
      formula: string;
    };

export interface CatalogueEntry {
  hardwareVariantId: string;
  monthlyPriceVnd: bigint;
  dayPriceVnd: bigint;
}

// api-design 01 without the variant code, name and active flag, which belong to `devices`.
export interface Catalogue {
  minOrderQuantity: number;
  holdingFeeRatio: number;
  dayPlanLengths: number[];
  dayPremium: number;
  prices: CatalogueEntry[];
}

export interface NewPriceInput {
  hardwareVariantId: string;
  monthlyPriceVnd: bigint;
  effectiveFrom: Date;
}

export interface NewDamageRateInput {
  code: string;
  label: string;
  hardwareVariantId: string | null;
  amountVnd: bigint;
}

export type PriceState = 'CURRENT' | 'UPCOMING' | 'PAST';

export type PriceHistoryItem = Omit<PriceRow, 'createdById'> & {
  createdBy: ActorRef | null;
  state: PriceState;
};

const decimal = (value: number): Prisma.Decimal => new Prisma.Decimal(value.toString());

const isPrismaError = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

const variantNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Hardware variant not found.');

const damageRateNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Damage rate not found.');

const auditOf = (
  actor: Caller,
  event: Omit<AuditRecordEvent, 'actorId' | 'actorRoles' | 'organizationId'>,
) =>
  ({
    actorId: actor.id,
    actorRoles: actor.roles,
    organizationId: null,
    ...event,
  }) satisfies AuditRecordEvent;

// Prices, the damage schedule, the plan catalogue, quotes and the contract snapshot (billing task
// 2.1, UC-56, FR-BILL-01, FR-BILL-02, FR-BILL-04, FR-CFG-02). Amounts are integer VND, every line
// rounded up (money.ts).
@Injectable()
export class PricingService {
  constructor(
    private readonly pricing: PricingRepository,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  // The monthly price in effect now and the two plan parameters, read in the caller's transaction
  // when it passes one (rentals 2.1). A variant with no price in effect is 404.
  async snapshot(
    variantId: string,
    tx?: Prisma.TransactionClient,
    at: Date = new Date(),
  ): Promise<PriceSnapshot> {
    const [price, dayPremium, holdingFeeRatio] = await Promise.all([
      this.pricing.currentPrice(variantId, at, tx),
      this.parameters.get('billing.dayPremium', tx),
      this.parameters.get('billing.holdingFeeRatio', tx),
    ]);
    if (!price) throw this.noPrice();
    return {
      monthlyUnitPriceVnd: price.monthlyPriceVnd,
      dayPremium: decimal(dayPremium),
      holdingFeeRatio: decimal(holdingFeeRatio),
    };
  }

  // Prices a prospective contract; nothing is stored (api-design 02). Below the minimum order
  // quantity is 400 BELOW_MOQ; a day-plan length outside `rentals.dayPlanLengths` is 400
  // VALIDATION_FAILED.
  async quote(input: QuoteInput, at: Date = new Date()): Promise<Quote> {
    const minOrderQuantity = await this.parameters.get('rentals.minOrderQuantity');
    if (input.quantity < minOrderQuantity) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BELOW_MOQ,
        `The minimum order is ${minOrderQuantity} devices.`,
      );
    }
    if (input.planType === PlanType.DAY) {
      const lengths = await this.dayPlanLengths();
      if (input.dayPlanDays === undefined || !lengths.includes(input.dayPlanDays)) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          `dayPlanDays must be one of ${lengths.join(', ')}.`,
        );
      }
    }

    const {
      monthlyUnitPriceVnd: price,
      dayPremium,
      holdingFeeRatio,
    } = await this.snapshot(input.hardwareVariantId, undefined, at);
    const quantity = input.quantity;
    if (input.planType === PlanType.MONTHLY) {
      return {
        planType: PlanType.MONTHLY,
        quantity,
        termFeeVnd: termFeeVnd(price, quantity),
        firstPaymentVnd: holdingFeeVnd(price, quantity, holdingFeeRatio),
        formula: `${price} x ${quantity} x ${holdingFeeRatio.toString()}`,
      };
    }
    const days = input.dayPlanDays as number;
    const totalVnd = dayPlanFeeVnd(price, dayPremium, days, quantity);
    return {
      planType: PlanType.DAY,
      quantity,
      unitPerDayVnd: dayPlanFeeVnd(price, dayPremium, 1, 1),
      days,
      totalVnd,
      firstPaymentVnd: totalVnd,
      formula: `${price} / 30 x ${dayPremium.toString()} x ${days} x ${quantity}`,
    };
  }

  // The public plan catalogue (api-design 01): the price in effect per variant and the plan
  // parameters. The controller joins the variants' code, name and active flag from `devices`.
  async catalogue(at: Date = new Date()): Promise<Catalogue> {
    const [prices, minOrderQuantity, holdingFeeRatio, dayPlanLengths, dayPremium] =
      await Promise.all([
        this.pricing.currentPrices(at),
        this.parameters.get('rentals.minOrderQuantity'),
        this.parameters.get('billing.holdingFeeRatio'),
        this.dayPlanLengths(),
        this.parameters.get('billing.dayPremium'),
      ]);
    return {
      minOrderQuantity,
      holdingFeeRatio,
      dayPlanLengths,
      dayPremium,
      prices: prices.map((row) => ({
        hardwareVariantId: row.hardwareVariantId,
        monthlyPriceVnd: row.monthlyPriceVnd,
        dayPriceVnd: dayPlanFeeVnd(row.monthlyPriceVnd, decimal(dayPremium), 1, 1),
      })),
    };
  }

  // Appends a monthly price effective now or later (api-design 04); contracts already requested
  // keep their snapshot. A past effective time is 400 EFFECTIVE_IN_PAST.
  async setPrice(input: NewPriceInput, actor: Caller, now: Date = new Date()): Promise<PriceRow> {
    if (input.effectiveFrom.getTime() < now.getTime()) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.EFFECTIVE_IN_PAST,
        'effectiveFrom must not be in the past.',
      );
    }
    try {
      return await this.events.transaction(async (tx) => {
        const price = await this.pricing.insertPrice({ ...input, createdById: actor.id }, tx);
        this.events.emitAfterCommit(
          AUDIT_RECORD,
          auditOf(actor, {
            action: 'price.set',
            subjectType: 'PriceSchedule',
            subjectId: price.id,
            after: {
              hardwareVariantId: price.hardwareVariantId,
              monthlyPriceVnd: price.monthlyPriceVnd.toString(),
              effectiveFrom: price.effectiveFrom,
            },
          }),
        );
        return price;
      });
    } catch (error) {
      if (isPrismaError(error, 'P2003')) throw variantNotFound();
      throw error;
    }
  }

  // The append-only schedule, newest first, with the name of who set each row (api-design 03).
  async history(
    variantId: string | undefined,
    query: PagedQueryDto,
    at: Date = new Date(),
  ): Promise<PagedResult<PriceHistoryItem>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.pricing.pricePage(variantId, page.skip, page.take);
    // Current, upcoming or past against the whole schedule, not this page (review of #91).
    const current = await this.pricing.currentPriceIds(at);
    const stateOf = (row: PriceRow): PriceState =>
      row.effectiveFrom.getTime() > at.getTime()
        ? 'UPCOMING'
        : current.has(row.id)
          ? 'CURRENT'
          : 'PAST';
    const actorOf = await resolveActors(
      this.directory,
      rows.map((row) => row.createdById),
    );
    const items = rows.map((row) => {
      const { createdById, ...rest } = row;
      return { ...rest, createdBy: actorOf(createdById), state: stateOf(row) };
    });
    return toPagedResult(items, total, page);
  }

  // Every damage rate, or the generic ones plus those of a variant (api-design 05).
  damageRates(variantId?: string): Promise<DamageRateRow[]> {
    return this.pricing.damageRates(variantId);
  }

  // A code already defined for the same variant, or generically, is 409 CONFLICT_UNIQUE through the
  // unique index (api-design 06).
  async createDamageRate(input: NewDamageRateInput, actor: Caller): Promise<DamageRateRow> {
    try {
      return await this.pricing.insertDamageRate({ ...input, createdById: actor.id });
    } catch (error) {
      if (isPrismaError(error, 'P2003')) throw variantNotFound();
      throw error;
    }
  }

  // Changes the label, amount or active flag; charges already created keep their amount
  // (api-design 07).
  async updateDamageRate(
    id: string,
    patch: DamageRatePatch,
    actor: Caller,
  ): Promise<DamageRateRow> {
    return this.events.transaction(async (tx) => {
      const before = await this.pricing.findDamageRate(id, tx);
      if (!before) throw damageRateNotFound();
      const after = await this.pricing.updateDamageRate(id, patch, tx);
      this.events.emitAfterCommit(
        AUDIT_RECORD,
        auditOf(actor, {
          action: 'damageRate.update',
          subjectType: 'DamageRate',
          subjectId: id,
          before: {
            label: before.label,
            amountVnd: before.amountVnd.toString(),
            isActive: before.isActive,
          },
          after: {
            label: after.label,
            amountVnd: after.amountVnd.toString(),
            isActive: after.isActive,
          },
        }),
      );
      return after;
    });
  }

  // The amount of one damage code for a variant: its own active rate, else the generic one; null
  // when neither is active (billing design §2, used by the damage charge of task 2.5).
  async damageRateFor(
    code: string,
    variantId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<bigint | null> {
    const rates = await this.pricing.activeRates(code, variantId, tx);
    const own = rates.find((rate) => rate.hardwareVariantId === variantId);
    const generic = rates.find((rate) => rate.hardwareVariantId === null);
    return (own ?? generic)?.amountVnd ?? null;
  }

  private async dayPlanLengths(): Promise<number[]> {
    const value = await this.parameters.get('rentals.dayPlanLengths');
    return Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : [];
  }

  private noPrice() {
    return new DomainException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'No price is in effect for this hardware variant.',
    );
  }
}
