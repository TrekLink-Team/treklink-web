import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { InspectionResult } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsUUID,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ContractReadsService } from './contract-reads.service';
import { contractBase } from './contracts.controller';
import { ReplacementService } from './replacement.service';
import { ReturnService } from './return.service';

// rentals api-design 14.
export class CheckInDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  assetTags!: string[];
}

// rentals api-design 15. The signature PNG stays under the global HTTP_BODY_LIMIT.
export class ReplacementDto {
  @IsUUID()
  replacementDeviceId!: string;

  @IsInt()
  @Min(1)
  keyVersion!: number;

  @IsString()
  @IsNotEmpty()
  signatureImage!: string;

  @IsBoolean()
  faultyPresent!: boolean;
}

// rentals api-design 16.
export class InspectionDto {
  @IsIn(Object.values(InspectionResult))
  result!: InspectionResult;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  damageCodes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// rentals api-design 17.
export class CloseDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// The end of a contract at the counter (rentals tasks 4.1, 4.2, 4.4; api-design 14, 16, 17; MF-05).
// TrekLink Staff operate the counter (`contract.operate`). The check-in message is static; the page
// builds MSG07 with the counts of the result.
@Controller('contracts')
export class ReturnController {
  constructor(
    private readonly returns: ReturnService,
    private readonly reads: ContractReadsService,
    private readonly replacements: ReplacementService,
  ) {}

  @Post(':id/check-ins')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Check-in complete.')
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckInDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.returns.checkIn(id, dto.assetTags, caller);
  }

  @Post(':id/devices/:deviceId/replacement')
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Device replaced')
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: ReplacementDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.replacements.replace(id, deviceId, dto, caller);
  }

  @Post(':id/devices/:deviceId/inspection')
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Inspection recorded')
  inspect(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: InspectionDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.returns.inspect(
      id,
      deviceId,
      { result: dto.result, damageCodes: dto.damageCodes ?? [], note: dto.note?.trim() || null },
      caller,
    );
  }

  // rentals api-design 20 (REQ-EVT-17, D-092 rule 3): what still blocks the close, for Staff at the
  // counter and on the contract page. Read only.
  @Get(':id/close-check')
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('OK')
  closeCheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.returns.closeCheck(id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Contract closed')
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseDto,
    @CurrentCaller() caller: Caller,
  ) {
    const closed = await this.returns.close(id, dto.expectedVersion, caller);
    const labels = (await this.reads.labeller([closed]))(closed);
    return {
      ...contractBase(closed, labels.organization, labels.variantCode, null),
      closedAt: closed.statusChangedAt,
    };
  }
}
