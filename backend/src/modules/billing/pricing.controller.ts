import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CheckPolicies, Public } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DevicesService } from '../devices';
import { QuoteDto } from './dto/quote.dto';
import { Quote, PricingService } from './pricing.service';

export interface PlanVariantView {
  id: string;
  code: string;
  name: string;
  monthlyPriceVnd: number;
  dayPriceVnd: number;
}

export interface PlansView {
  minOrderQuantity: number;
  holdingFeeRatio: number;
  dayPlanLengths: number[];
  dayPremium: number;
  variants: PlanVariantView[];
  sandbox: true;
}

export type QuoteView = { [K in keyof Quote]: Quote[K] extends bigint ? number : Quote[K] };

// A JSON body cannot hold a bigint; every VND amount here is far below Number.MAX_SAFE_INTEGER.
const vnd = (amount: bigint): number => Number(amount);

export const toQuoteView = (quote: Quote): QuoteView =>
  Object.fromEntries(
    Object.entries(quote).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? vnd(value) : value,
    ]),
  ) as QuoteView;

// The plan catalogue and quotes (billing task 5.1 part, api-design 01 and 02).
@Controller()
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly devices: DevicesService,
  ) {}

  // Public: what the website sells. Only active variants that have a price in effect are listed;
  // payments always run in the gateway's sandbox (D-033 item 9).
  @Get('plans')
  @Public()
  @ResponseMessage('OK')
  async plans(): Promise<PlansView> {
    const [catalogue, variants] = await Promise.all([
      this.pricing.catalogue(),
      this.devices.variants(true),
    ]);
    const priceOf = new Map(catalogue.prices.map((price) => [price.hardwareVariantId, price]));
    return {
      minOrderQuantity: catalogue.minOrderQuantity,
      holdingFeeRatio: catalogue.holdingFeeRatio,
      dayPlanLengths: catalogue.dayPlanLengths,
      dayPremium: catalogue.dayPremium,
      variants: variants.flatMap((variant) => {
        const price = priceOf.get(variant.id);
        return price
          ? [
              {
                id: variant.id,
                code: variant.code,
                name: variant.name,
                monthlyPriceVnd: vnd(price.monthlyPriceVnd),
                dayPriceVnd: vnd(price.dayPriceVnd),
              },
            ]
          : [];
      }),
      sandbox: true,
    };
  }

  // Org Manager (own organization) and TrekLink Staff; nothing is stored.
  @Post('quotes')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('quote', 'Plan'))
  @ResponseMessage('OK')
  async quote(@Body() dto: QuoteDto): Promise<QuoteView> {
    return toQuoteView(await this.pricing.quote(dto));
  }
}
