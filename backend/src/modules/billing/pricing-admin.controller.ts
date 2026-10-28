import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  DamageRatePatchDto,
  DamageRateQueryDto,
  NewDamageRateDto,
  NewPriceDto,
  PriceHistoryQueryDto,
} from './dto/pricing-admin.dto';
import { DamageRateRow, PriceRow } from './pricing.repository';
import { PricingService } from './pricing.service';

// A JSON body cannot hold a bigint; every VND amount here is far below Number.MAX_SAFE_INTEGER.
const vnd = (amount: bigint): number => Number(amount);

const toPriceView = (price: Omit<PriceRow, 'createdById'>) => ({
  id: price.id,
  hardwareVariantId: price.hardwareVariantId,
  monthlyPriceVnd: vnd(price.monthlyPriceVnd),
  effectiveFrom: price.effectiveFrom,
  createdAt: price.createdAt,
});

export const toDamageRateView = (rate: DamageRateRow) => ({
  id: rate.id,
  code: rate.code,
  label: rate.label,
  hardwareVariantId: rate.hardwareVariantId,
  amountVnd: vnd(rate.amountVnd),
  isActive: rate.isActive,
});

// The price schedule and the damage schedule (billing task 5.1 part, api-design 03 to 07, UC-56).
// TrekLink Admin manages both; TrekLink Staff reads the damage rates they inspect against.
@Controller()
export class PricingAdminController {
  constructor(private readonly pricing: PricingService) {}

  @Get('price-schedules')
  @CheckPolicies((ability) => ability.can('manage', 'PriceSchedule'))
  @ResponseMessage('OK')
  async history(@Query() query: PriceHistoryQueryDto) {
    const page = await this.pricing.history(query.hardwareVariantId, query);
    return {
      ...page,
      items: page.items.map((item) => ({
        ...toPriceView(item),
        createdBy: item.createdBy?.fullName ?? null,
      })),
    };
  }

  @Post('price-schedules')
  @CheckPolicies((ability) => ability.can('manage', 'PriceSchedule'))
  @ResponseMessage('Saved.')
  async setPrice(@Body() dto: NewPriceDto, @CurrentCaller() caller: Caller) {
    const price = await this.pricing.setPrice(
      {
        hardwareVariantId: dto.hardwareVariantId,
        monthlyPriceVnd: BigInt(dto.monthlyPriceVnd),
        effectiveFrom: new Date(dto.effectiveFrom),
      },
      caller,
    );
    return toPriceView(price);
  }

  @Get('damage-rates')
  @CheckPolicies((ability) => ability.can('read', 'DamageRate'))
  @ResponseMessage('OK')
  async damageRates(@Query() query: DamageRateQueryDto) {
    return (await this.pricing.damageRates(query.hardwareVariantId)).map(toDamageRateView);
  }

  @Post('damage-rates')
  @CheckPolicies((ability) => ability.can('manage', 'DamageRate'))
  @ResponseMessage('Saved.')
  async createDamageRate(@Body() dto: NewDamageRateDto, @CurrentCaller() caller: Caller) {
    const rate = await this.pricing.createDamageRate(
      {
        code: dto.code,
        label: dto.label.trim(),
        hardwareVariantId: dto.hardwareVariantId ?? null,
        amountVnd: BigInt(dto.amountVnd),
      },
      caller,
    );
    return toDamageRateView(rate);
  }

  @Patch('damage-rates/:id')
  @CheckPolicies((ability) => ability.can('manage', 'DamageRate'))
  @ResponseMessage('Saved.')
  async updateDamageRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DamageRatePatchDto,
    @CurrentCaller() caller: Caller,
  ) {
    const rate = await this.pricing.updateDamageRate(
      id,
      {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.amountVnd !== undefined ? { amountVnd: BigInt(dto.amountVnd) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      caller,
    );
    return toDamageRateView(rate);
  }
}
