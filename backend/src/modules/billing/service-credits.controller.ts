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
import {
  ServiceCreditDecisionDto,
  ServiceCreditQueryDto,
  ServiceCreditRefundDto,
  ServiceCreditRequestDto,
} from './dto/service-credits.dto';
import { ServiceCreditService } from './service-credit.service';
import { ServiceCreditRow } from './service-credits.repository';

// A JSON body cannot hold a bigint; every VND amount here is far below Number.MAX_SAFE_INTEGER.
const vnd = (amount: bigint | null): number | null => (amount === null ? null : Number(amount));

const toServiceCreditView = (
  credit: ServiceCreditRow & {
    assetTag?: string | null;
    release?: { reason: string; releasedAt: Date } | null;
  },
) => ({
  id: credit.id,
  contractId: credit.contractId,
  contractDeviceId: credit.contractDeviceId,
  deviceId: credit.deviceId,
  assetTag: credit.assetTag ?? null,
  kind: credit.kind,
  unitReleaseId: credit.unitReleaseId,
  // the release a RELEASE credit pays for (design §12.1), shown in place of the outage
  release: credit.release ?? null,
  cause: credit.cause,
  faultInspectionId: credit.faultInspectionId,
  outageFrom: credit.outageFrom,
  outageSourceIncidentId: credit.outageSourceIncidentId,
  outageSourceFaultReportId: credit.outageSourceFaultReportId,
  outageSourceNote: credit.outageSourceNote,
  outageTo: credit.outageTo,
  outageDays: credit.outageDays,
  computedVnd: vnd(credit.computedVnd),
  decidedVnd: vnd(credit.decidedVnd),
  appliedVnd: vnd(credit.appliedVnd),
  status: credit.status,
  requestedById: credit.requestedById,
  decisionReason: credit.decisionReason,
  decidedAt: credit.decidedAt,
  refundReference: credit.refundReference,
  refundedAt: credit.refundedAt,
  version: credit.version,
  createdAt: credit.createdAt,
});

// Service credits (billing task 8.1, design §9.5, D-092 rule 5). TrekLink Staff request credits and
// record refunds; an Admin who did not request a credit decides it; an organization's Managers read
// their own (serviceCredit.read.own).
@Controller()
export class ServiceCreditsController {
  constructor(private readonly credits: ServiceCreditService) {}

  @Post('contracts/:id/service-credits')
  @CheckPolicies((ability) => ability.can('request', 'ServiceCredit'))
  @ResponseMessage('Service credit requested')
  async request(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Body() dto: ServiceCreditRequestDto,
    @CurrentCaller() caller: Caller,
  ) {
    return toServiceCreditView(await this.credits.request(contractId, dto, caller));
  }

  @Get('contracts/:id/service-credits')
  @CheckPolicies((ability) => ability.can('read', 'ServiceCredit'))
  @ResponseMessage('OK')
  async ofContract(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Query() query: ServiceCreditQueryDto,
    @CurrentCaller() caller: Caller,
  ) {
    const page = await this.credits.list(
      { contractId, status: query.status, organizationId: caller.organizationId ?? undefined },
      query,
    );
    return { ...page, items: page.items.map(toServiceCreditView) };
  }

  @Get('service-credits')
  @CheckPolicies((ability) => ability.can('read', 'ServiceCredit'))
  @ResponseMessage('OK')
  async list(@Query() query: ServiceCreditQueryDto, @CurrentCaller() caller: Caller) {
    const page = await this.credits.list(
      {
        status: query.status,
        contractId: query.contractId,
        organizationId: caller.organizationId ?? undefined,
      },
      query,
    );
    return { ...page, items: page.items.map(toServiceCreditView) };
  }

  @Post('service-credits/:id/decision')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('decide', 'ServiceCredit'))
  @ResponseMessage('Decision recorded')
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ServiceCreditDecisionDto,
    @CurrentCaller() caller: Caller,
  ) {
    return toServiceCreditView(await this.credits.decide(id, dto, caller));
  }

  @Post('service-credits/:id/refund')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('refund', 'ServiceCredit'))
  @ResponseMessage('Refund recorded')
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ServiceCreditRefundDto,
    @CurrentCaller() caller: Caller,
  ) {
    return toServiceCreditView(await this.credits.recordRefund(id, dto.reference, caller));
  }
}
