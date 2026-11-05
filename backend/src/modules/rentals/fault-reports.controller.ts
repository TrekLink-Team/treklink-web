import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { FaultReportsService } from './fault-reports.service';

class ReportFaultDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000, { message: 'description must be 1 to 1000 characters.' })
  description!: string;
}

@Controller('contracts')
export class FaultReportsController {
  constructor(private readonly faults: FaultReportsService) {}

  @Post(':id/devices/:deviceId/fault-reports')
  @CheckPolicies((ability) => ability.can('create', 'DeviceFaultReport'))
  @ResponseMessage('Fault reported. TrekLink will contact you about a replacement.')
  report(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() body: ReportFaultDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.faults.report(contractId, deviceId, body.description, caller);
  }

  @Get(':id/fault-reports')
  @CheckPolicies((ability) => ability.can('read', 'DeviceFaultReport'))
  @ResponseMessage('OK')
  ofContract(@Param('id', ParseUUIDPipe) contractId: string, @CurrentCaller() caller: Caller) {
    return this.faults.ofContract(contractId, caller);
  }
}
