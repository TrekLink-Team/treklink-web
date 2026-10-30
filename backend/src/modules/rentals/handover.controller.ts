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
import { ContractReadsService } from './contract-reads.service';
import { contractBase } from './contracts.controller';
import {
  HandoverDto,
  HandoverPreviewQueryDto,
  ProvisioningDto,
  SwapDto,
} from './dto/contract-decision.dto';
import { HandoverService } from './handover.service';

// The counter handover (rentals tasks 2.3 and 2.4, api-design 07 to 11). TrekLink Staff operate the
// counter (`contract.operate`); the signed note is read by the Org Manager of the contract
// (`handoverNote.read.own`) and by Staff and Admin (`handoverNote.read`).
@Controller('contracts')
export class HandoverController {
  constructor(
    private readonly handover: HandoverService,
    private readonly reads: ContractReadsService,
  ) {}

  @Post(':id/devices/:deviceId/swap')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Device swapped')
  swap(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: SwapDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.handover.swap(id, deviceId, dto.reason.trim(), caller);
  }

  @Post(':id/devices/:deviceId/provisioning')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Provisioning recorded')
  async provision(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: ProvisioningDto,
    @CurrentCaller() caller: Caller,
  ) {
    const device = await this.handover.provision(id, deviceId, dto.keyVersion, caller);
    return {
      deviceId: device.id,
      assetTag: device.assetTag,
      status: device.status,
      keyVersion: device.keyVersion,
      keyOrganizationId: device.keyOrganizationId,
      provisionedAt: device.provisionedAt,
    };
  }

  @Get(':id/handover-note/preview')
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('OK')
  async preview(@Param('id', ParseUUIDPipe) id: string, @Query() query: HandoverPreviewQueryDto) {
    const pdf = await this.handover.preview(id, query.checks ?? []);
    return { pdfBase64: pdf.toString('base64'), sha256: null };
  }

  // The envelope message is static; the page shows MSG06 with the count and the code.
  @Post(':id/handover')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Handover complete.')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandoverDto,
    @CurrentCaller() caller: Caller,
  ) {
    const contract = await this.handover.complete(
      id,
      {
        signedByUserId: dto.signedByMemberId,
        identityChecked: dto.identityChecked.trim(),
        signaturePng: dto.signaturePng,
        deviceChecks: dto.deviceChecks,
        acknowledgeLowBattery: dto.acknowledgeLowBattery === true,
        expectedVersion: dto.expectedVersion,
      },
      caller,
    );
    const label = await this.reads.labeller([contract]);
    const labels = label(contract);
    return {
      ...contractBase(contract, labels.organization, labels.variantCode, null),
      devicesHandedOver: dto.deviceChecks.length,
    };
  }

  @Get(':id/handover-note')
  @CheckPolicies((ability) => ability.can('read', 'HandoverNote'))
  @ResponseMessage('OK')
  note(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.handover.note(id, caller);
  }
}
