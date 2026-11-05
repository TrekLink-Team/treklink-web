import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LossCaseState } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService, LossCaseService } from '../devices';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsService, GroupsService } from '../rentals';
import { custodyView, type UnitState } from './custody-view';

interface RentedDevicesQuery extends PagedQueryDto {
  contractId?: string;
  groupId?: string;
  state?: UnitState;
}

const OPEN_LOSS_STATES: readonly LossCaseState[] = [
  LossCaseState.REPORTED,
  LossCaseState.SEARCHING,
  LossCaseState.CONFIRMED,
];

@Injectable()
export class RentedDevicesService {
  constructor(
    private readonly contracts: ContractsService,
    private readonly groups: GroupsService,
    private readonly devices: DevicesService,
    private readonly losses: LossCaseService,
    private readonly parameters: ParameterService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async list(query: RentedDevicesQuery, caller: Caller, now = new Date()) {
    const organizationId = caller.organizationId;
    if (!organizationId || !caller.roles.includes('ORG_MANAGER')) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have access to this.',
      );
    }
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [, groupIds, held] = await Promise.all([
      query.contractId && this.contracts.assertOwnContract(query.contractId, organizationId),
      query.groupId && query.groupId !== 'none'
        ? this.groups.subgroupIds(organizationId, query.groupId)
        : undefined,
      this.contracts.visibleDevices({ organizationId }),
    ]);
    // Demo-sized organization fleets are filtered and paged in memory after custody clipping.
    // Larger fleets need this read pushed into a paged query that preserves the same state rules.
    const rentals = new Map(
      held
        .filter((unit) => !query.contractId || unit.contractId === query.contractId)
        .filter(({ group }) => {
          if (query.groupId === 'none') return group === null;
          return !groupIds || (group !== null && groupIds.has(group.id));
        })
        .map((unit) => [unit.deviceId, unit]),
    );
    const [projections, staleSeconds] = await Promise.all([
      this.devices.projections([...rentals.keys()]),
      this.parameters.get('monitoring.deviceStaleSeconds'),
    ]);
    const staleBefore = now.getTime() - staleSeconds * 1000;
    const rows = projections.flatMap((device) => {
      const unit = rentals.get(device.id);
      if (!unit) return [];
      const view = custodyView(device, unit.handedOverAt, staleBefore, true);
      if (query.state && query.state !== view.state) return [];
      return [
        {
          deviceId: unit.deviceId,
          assetTag: device.assetTag,
          variantCode: device.variantCode,
          contract: {
            id: unit.contractId,
            code: unit.contractCode,
            planType: unit.planType,
            status: unit.contractStatus,
          },
          contractDeviceId: unit.contractDeviceId,
          handedOverAt: unit.handedOverAt.toISOString(),
          state: view.state,
          batteryPct: view.batteryPct,
          lastSeenAt: view.lastSeenAt,
          group: unit.group,
          holder: unit.holder,
          openFaultReportId: unit.openFaultReportId,
        },
      ];
    });
    rows.sort(
      (a, b) => a.assetTag.localeCompare(b.assetTag) || a.deviceId.localeCompare(b.deviceId),
    );
    const selected = rows.slice(page.skip, page.skip + page.take);
    // Read by custody row so another renter's loss case can never be exposed.
    const losses = await this.losses.summariesOfContractDevices(
      selected.map(({ contractDeviceId }) => contractDeviceId),
    );
    return toPagedResult(
      selected.map((row) => {
        const loss = losses.get(row.contractDeviceId);
        return {
          ...row,
          openLossCase:
            loss && OPEN_LOSS_STATES.includes(loss.state)
              ? { id: loss.id, code: loss.code, state: loss.state }
              : null,
        };
      }),
      rows.length,
      page,
    );
  }
}
