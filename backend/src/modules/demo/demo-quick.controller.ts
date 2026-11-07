import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DemoQuickService, QuickInput } from './demo-quick.service';

export class DemoQuickDto implements QuickInput {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() hardwareVariantId?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional()
  @IsIn(['REQUESTED', 'APPROVED', 'ACTIVE', 'RETURN_DUE'])
  target?: QuickInput['target'];
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsUUID() recordId?: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('demo/quick')
export class DemoQuickController {
  constructor(private readonly quick: DemoQuickService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('stage', 'Demo'))
  @ResponseMessage('OK')
  options(@CurrentCaller() caller: Caller) {
    return this.quick.options(caller);
  }

  @Post(':action')
  @HttpCode(200)
  @CheckPolicies((ability) => ability.can('stage', 'Demo'))
  @ResponseMessage('Demo action completed')
  run(@Param('action') action: string, @Body() dto: DemoQuickDto, @CurrentCaller() caller: Caller) {
    return this.quick.run(action, dto, caller);
  }
}
