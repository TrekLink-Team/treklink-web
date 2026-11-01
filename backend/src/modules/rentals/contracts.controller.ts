import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DevicesService, type ReturnState } from '../devices';
import { PagedResult } from '../../common/dto/paging';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractLabels, ContractReadsService, TransitionView } from './contract-reads.service';
import { ContractRow, DEVICE_ROW_SELECT } from './contracts.repository';
import { ContractsService, RequestQuote } from './contracts.service';
import {
  ApproveContractDto,
  ContractQueryDto,
  ContractReasonDto,
  HolderDto,
  NoticeDto,
} from './dto/contract-decision.dto';
import { ContractRequestDto } from './dto/contract-request.dto';

// The caller's organization as the verified request context holds it (auth design §2): id, code and
// legal name. Read structurally, because `rentals` does not import `auth`.
export interface OrganizationRef {
  id: string;
  code: string;
  legalName: string;
}

export const callerOrganization = (
  _data: unknown,
  context: ExecutionContext,
): OrganizationRef | null => {
  const user = context
    .switchToHttp()
    .getRequest<{ user?: { organization?: OrganizationRef | null } }>().user;
  const organization = user?.organization;
  return organization
    ? { id: organization.id, code: organization.code, legalName: organization.legalName }
    : null;
};

export const CurrentOrganization = createParamDecorator(callerOrganization);

export interface TermView {
  seq: number;
  startsAt: Date;
  endsAt: Date;
}

export interface ContractView {
  id: string;
  code: string;
  organization: OrganizationRef | null;
  planType: ContractRow['planType'];
  dayPlanDays: number | null;
  hardwareVariant: { id: string; code: string | null };
  quantity: number;
  requestedStartDate: string;
  monthlyUnitPriceVnd: number;
  dayPremium: number | null;
  holdingFeeRatio: number;
  status: ContractRow['status'];
  statusChangedAt: Date;
  handedOverAt: Date | null;
  currentTerm: TermView | null;
  endsAt: Date | null;
  noticeGivenAt: Date | null;
  returnDueAt: Date | null;
  version: number;
  quote?: Record<string, number>;
}

type DeviceRow = Prisma.ContractDeviceGetPayload<{ select: typeof DEVICE_ROW_SELECT }>;

export interface DeviceRowView {
  deviceId: string;
  assetTag: string | null;
  handedOverAt: Date | null;
  checkedInAt: Date | null;
  lostAt: Date | null;
  holder: { name: string; phone: string | null; emergencyContact: string | null } | null;
}

export const toDeviceRowView = (row: DeviceRow, assetTag: string | null): DeviceRowView => ({
  deviceId: row.deviceId,
  assetTag,
  handedOverAt: row.handedOverAt,
  checkedInAt: row.checkedInAt,
  lostAt: row.lostAt,
  holder: row.holderName
    ? { name: row.holderName, phone: row.holderPhone, emergencyContact: row.holderEmergencyContact }
    : null,
});

// A JSON body cannot hold a bigint; every VND amount here is far below Number.MAX_SAFE_INTEGER.
const toNumbers = (quote: RequestQuote): Record<string, number> =>
  Object.fromEntries(Object.entries(quote).map(([key, value]) => [key, Number(value)]));

// The contract fields every rentals endpoint answers (api-design 01 to 06).
export const contractBase = (
  contract: ContractRow,
  organization: OrganizationRef | null,
  variantCode: string | null,
  currentTerm: TermView | null,
): ContractView => ({
  id: contract.id,
  code: contract.code,
  organization,
  planType: contract.planType,
  dayPlanDays: contract.dayPlanDays,
  hardwareVariant: { id: contract.hardwareVariantId, code: variantCode },
  quantity: contract.quantity,
  requestedStartDate: contract.requestedStartDate.toISOString().slice(0, 10),
  monthlyUnitPriceVnd: Number(contract.monthlyUnitPriceVnd),
  dayPremium: contract.dayPremium === null ? null : contract.dayPremium.toNumber(),
  holdingFeeRatio: contract.holdingFeeRatio.toNumber(),
  status: contract.status,
  statusChangedAt: contract.statusChangedAt,
  handedOverAt: contract.handedOverAt,
  currentTerm,
  endsAt: contract.endsAt,
  noticeGivenAt: contract.noticeGivenAt,
  returnDueAt: contract.returnDueAt,
  version: contract.version,
});

export const toContractView = (
  contract: ContractRow,
  organization: OrganizationRef | null,
  variantCode: string | null,
  quote: RequestQuote,
  currentTerm: TermView | null = null,
): ContractView => ({
  ...contractBase(contract, organization, variantCode, currentTerm),
  quote: toNumbers(quote),
});

// api-design 01 since D-092 rule 1: the request answers the units it holds and when the hold expires.
export interface RequestView extends ContractView {
  holdExpiresAt: Date;
  heldDevices: number;
}

const termOf = (terms: readonly TermView[]): TermView | null => {
  const term = terms.at(-1);
  return term ? { seq: term.seq, startsAt: term.startsAt, endsAt: term.endsAt } : null;
};

// rentals api-design 03 `devices[].afterReturn` (REQ-EVT-19): null for a row not checked in or with no
// state read (an organization caller); the next step only on the row of the unit's latest return.
export const afterReturnOf = (
  contractId: string,
  device: { checkedInAt: Date | null },
  state: ReturnState | undefined,
) =>
  device.checkedInAt && state
    ? {
        status: state.status,
        nextStep: state.lastReturnContractId === contractId ? state.nextStep : null,
      }
    : null;

const labelledView = (
  contract: ContractRow,
  labels: ContractLabels,
  currentTerm: TermView | null,
): ContractView => contractBase(contract, labels.organization, labels.variantCode, currentTerm);

// Rental contracts (rentals task 6.1 part): the request (api-design 01), the list, detail and
// history (02, 03, 18), and the Staff decisions and the cancellation (04, 05, 06). The handover and
// end-of-contract endpoints join with their tasks.
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly devices: DevicesService,
    private readonly reads: ContractReadsService,
    private readonly decisions: ContractDecisionsService,
  ) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'RentalContract'))
  @ResponseMessage('OK')
  async list(
    @Query() query: ContractQueryDto,
    @CurrentCaller() caller: Caller,
  ): Promise<
    PagedResult<
      ContractView & {
        reservationExpiresAt: Date | null;
        handoverAppointmentAt: Date | null;
        holdExpiresAt: Date | null;
      }
    >
  > {
    const page = await this.reads.page(query, caller);
    return {
      ...page,
      items: page.items.map(({ row, ...labels }) => ({
        ...labelledView(row, labels, termOf(row.terms)),
        reservationExpiresAt: row.reservationExpiresAt,
        handoverAppointmentAt: row.handoverAppointmentAt,
        holdExpiresAt: row.holdExpiresAt,
      })),
    };
  }

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'RentalContract'))
  @ResponseMessage('OK')
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    const {
      row,
      assetTags,
      returnChecks,
      balance,
      provisionedKeyVersions,
      returnStates,
      ...labels
    } = await this.reads.detail(id, caller);
    return {
      ...labelledView(row, labels, termOf(row.terms)),
      reservationExpiresAt: row.reservationExpiresAt,
      handoverAppointmentAt: row.handoverAppointmentAt,
      holdExpiresAt: row.holdExpiresAt,
      terms: row.terms.map((term) => ({
        seq: term.seq,
        startsAt: term.startsAt,
        endsAt: term.endsAt,
        status: term.status,
      })),
      // resetAt and inspection belong to this row's return, so a reload of the counter keeps them.
      devices: row.devices.map((device) => {
        const check = returnChecks.get(device.id);
        return {
          ...toDeviceRowView(device, assetTags.get(device.deviceId) ?? null),
          resetAt: check?.resetAt ?? null,
          inspection: check?.inspection ?? null,
          // The key version written at the counter, so a reload keeps step 1 (frontend 5.4).
          provisionedKeyVersion: provisionedKeyVersions.get(device.deviceId) ?? null,
          // TrekLink callers: the unit's state after this return and its next step back to AVAILABLE,
          // shown only on the row of its latest return (REQ-EVT-19, D-092 rule 4).
          afterReturn: afterReturnOf(row.id, device, returnStates.get(device.deviceId)),
        };
      }),
      balance: { dueNowVnd: Number(balance.dueNowVnd), dueLaterVnd: Number(balance.dueLaterVnd) },
    };
  }

  @Get(':id/transitions')
  @CheckPolicies((ability) => ability.can('read', 'RentalContract'))
  @ResponseMessage('OK')
  transitions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
  ): Promise<TransitionView[]> {
    return this.reads.transitions(id, caller);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Contract approved')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveContractDto,
    @CurrentCaller() caller: Caller,
  ) {
    const approved = await this.decisions.approve(
      id,
      {
        handoverAt: new Date(dto.handoverAt),
        expectedVersion: dto.expectedVersion,
        deviceIds: dto.deviceIds,
      },
      caller,
    );
    const label = await this.reads.labeller([approved.contract]);
    return {
      ...labelledView(approved.contract, label(approved.contract), approved.term),
      reservationExpiresAt: approved.reservationExpiresAt,
      handoverAppointmentAt: approved.handoverAppointmentAt,
      devices: approved.devices.map((device) => ({
        deviceId: device.id,
        assetTag: device.assetTag,
        handedOverAt: null,
        checkedInAt: null,
        lostAt: null,
        holder: null,
      })),
    };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'RentalContract'))
  @ResponseMessage('Contract rejected')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContractReasonDto,
    @CurrentCaller() caller: Caller,
  ): Promise<ContractView & { paidVnd: number }> {
    const { contract, paidVnd } = await this.decisions.reject(id, dto, caller);
    const label = await this.reads.labeller([contract]);
    return { ...labelledView(contract, label(contract), null), paidVnd: Number(paidVnd) };
  }

  // Org Manager (own, `contract.cancel.own`) or TrekLink Staff (`contract.operate`).
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies(
    (ability) =>
      ability.can('cancel', 'RentalContract') || ability.can('operate', 'RentalContract'),
  )
  @ResponseMessage('Contract cancelled')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContractReasonDto,
    @CurrentCaller() caller: Caller,
  ) {
    const { contract, retainedVnd } = await this.decisions.cancel(id, dto, caller);
    const label = await this.reads.labeller([contract]);
    return { ...labelledView(contract, label(contract), null), retainedVnd: Number(retainedVnd) };
  }

  @Post()
  @CheckPolicies((ability) => ability.can('request', 'RentalContract'))
  @ResponseMessage(
    'Request sent. Your devices are held; TrekLink will confirm your handover appointment.',
  )
  async request(
    @Body() dto: ContractRequestDto,
    @CurrentCaller() caller: Caller,
    @CurrentOrganization() organization: OrganizationRef | null,
  ): Promise<RequestView> {
    const { contract, quote, heldDevices, term, holdExpiresAt } = await this.contracts.request(
      {
        planType: dto.planType,
        dayPlanDays: dto.dayPlanDays,
        hardwareVariantId: dto.hardwareVariantId,
        quantity: dto.quantity,
        requestedStartDate: new Date(`${dto.requestedStartDate}T00:00:00.000Z`),
      },
      caller,
    );
    const variants = await this.devices.variants(false);
    const variant = variants.find((item) => item.id === contract.hardwareVariantId);
    return {
      ...toContractView(contract, organization, variant?.code ?? null, quote, {
        seq: term.seq,
        startsAt: term.startsAt,
        endsAt: term.endsAt,
      }),
      holdExpiresAt,
      heldDevices,
    };
  }

  // Org Manager (own). The envelope message is static; the page shows MSG18 with the date and
  // `dueAtEndVnd` from the result.
  @Post(':id/notice')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('notice', 'RentalContract'))
  @ResponseMessage('Notice recorded.')
  async notice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoticeDto,
    @CurrentCaller() caller: Caller,
  ) {
    const { contract, term, dueAtEndVnd } = await this.decisions.giveNotice(
      id,
      dto.expectedVersion,
      caller,
    );
    const label = await this.reads.labeller([contract]);
    return {
      ...labelledView(contract, label(contract), term),
      dueAtEndVnd: Number(dueAtEndVnd),
    };
  }

  // Org Manager and Org Operator (own). A blank name clears the whole label (BR-33).
  @Put(':id/devices/:deviceId/holder')
  @CheckPolicies((ability) => ability.can('label', 'RentalContract'))
  @ResponseMessage('Saved.')
  async holder(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: HolderDto,
    @CurrentCaller() caller: Caller,
  ): Promise<DeviceRowView> {
    const name = dto.name?.trim();
    const row = await this.decisions.setHolder(
      id,
      deviceId,
      name
        ? {
            name,
            phone: dto.phone?.trim() || null,
            emergencyContact: dto.emergencyContact?.trim() || null,
          }
        : null,
      caller,
    );
    const tags = await this.devices.assetTags([deviceId]);
    return toDeviceRowView(row, tags.get(deviceId) ?? null);
  }
}
