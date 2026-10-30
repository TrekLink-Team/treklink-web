import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DamageChargeItem, DamageChargeService } from './damage-charge.service';
import { DamageChargeQueryDto, DamageDecisionDto } from './dto/damage-charges.dto';

// A JSON body cannot hold a bigint; every VND amount here is far below Number.MAX_SAFE_INTEGER.
const vnd = (amount: bigint | null): number | null => (amount === null ? null : Number(amount));

const toDamageChargeView = (charge: DamageChargeItem) => ({
  id: charge.id,
  contractId: charge.contractId,
  deviceId: charge.deviceId,
  assetTag: charge.assetTag,
  inspectionId: charge.inspectionId,
  inspector: charge.inspector,
  damageCodes: charge.damageCodes,
  amountVnd: vnd(charge.amountVnd),
  finalVnd: vnd(charge.finalVnd),
  status: charge.status,
  decisionNote: charge.decisionNote,
  decidedAt: charge.decidedAt,
  createdAt: charge.createdAt,
});

// Damage charges (billing task 5.1 part, api-design 16 and 17, UC-47, UC-48). TrekLink Staff and
// Admin read the list; only an Admin decides (`decide DamageCharge`), and never the inspector.
@Controller('damage-charges')
export class DamageChargesController {
  constructor(private readonly damageCharges: DamageChargeService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'DamageCharge'))
  @ResponseMessage('OK')
  async list(@Query() query: DamageChargeQueryDto) {
    const page = await this.damageCharges.list(
      { status: query.status, contractId: query.contractId },
      query,
    );
    return { ...page, items: page.items.map(toDamageChargeView) };
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('decide', 'DamageCharge'))
  @ResponseMessage('Decision recorded')
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DamageDecisionDto,
    @CurrentCaller() caller: Caller,
  ) {
    const charge = await this.damageCharges.decide(
      id,
      { decision: dto.decision, finalVnd: dto.finalVnd, note: dto.note },
      caller,
    );
    return {
      id: charge.id,
      status: charge.status,
      amountVnd: vnd(charge.amountVnd),
      finalVnd: vnd(charge.finalVnd),
      decidedAt: charge.decidedAt,
    };
  }
}
