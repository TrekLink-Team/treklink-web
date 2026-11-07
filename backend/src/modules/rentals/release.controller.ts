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
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ReleaseUnitDto } from './dto/contract-decision.dto';
import { ReleaseService } from './release.service';

// Release a unit (api-design 33 and 34, rentals design §13, D-099): TrekLink Staff only
// (`contract.releaseUnit`); organization roles have no release permission. A JSON body cannot hold a
// bigint, and every VND amount here is far below Number.MAX_SAFE_INTEGER.
@Controller('contracts')
export class ReleaseController {
  constructor(private readonly releases: ReleaseService) {}

  @Post(':id/devices/:deviceId/release')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('releaseUnit', 'RentalContract'))
  @ResponseMessage('Unit released')
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: ReleaseUnitDto,
    @CurrentCaller() caller: Caller,
  ) {
    const released = await this.releases.release(
      id,
      deviceId,
      { reason: dto.reason, expectedVersion: dto.expectedVersion },
      caller,
    );
    return {
      release: released.release,
      contract: released.contract,
      credit: released.credit
        ? { ...released.credit, computedVnd: Number(released.credit.computedVnd) }
        : null,
      firstInvoiceLoweredByVnd:
        released.firstInvoiceLoweredByVnd === null
          ? null
          : Number(released.firstInvoiceLoweredByVnd),
    };
  }

  @Get(':id/devices/:deviceId/release-preview')
  @CheckPolicies((ability) => ability.can('releaseUnit', 'RentalContract'))
  @ResponseMessage('OK')
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const preview = await this.releases.preview(id, deviceId);
    return {
      ...preview,
      credit: preview.credit
        ? { ...preview.credit, computedVnd: Number(preview.credit.computedVnd) }
        : null,
      firstInvoice: preview.firstInvoice
        ? {
            totalVnd: Number(preview.firstInvoice.totalVnd),
            paidVnd: Number(preview.firstInvoice.paidVnd),
            newTotalVnd: Number(preview.firstInvoice.newTotalVnd),
            owedToOrganizationVnd: Number(preview.firstInvoice.owedToOrganizationVnd),
          }
        : null,
    };
  }
}
