import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractStatus, PlanType } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService, BalanceSummary } from '../billing';
import { DevicesService, type ReturnCheck } from '../devices';
import { OrganizationLabel, OrganizationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../platform/ports/account-directory.port';
import { resolveActors } from '../platform/ports/actor-names';
import {
  ContractDetailRow,
  ContractListRow,
  ContractsRepository,
  TransitionRow,
} from './contracts.repository';

export interface ContractQuery extends PagedQueryDto {
  organizationId?: string;
  status?: ContractStatus;
  planType?: PlanType;
}

// What a contract view shows besides the row: its organization and variant labels.
export interface ContractLabels {
  organization: OrganizationLabel | null;
  variantCode: string | null;
}

export interface ContractDetail extends ContractLabels {
  row: ContractDetailRow;
  assetTags: Map<string, string>;
  // The reset and inspection of each returned row, by contract device id.
  returnChecks: Map<string, ReturnCheck>;
  balance: BalanceSummary;
}

export interface TransitionView {
  fromStatus: ContractStatus | null;
  toStatus: ContractStatus;
  actor: string | null;
  reason: string | null;
  createdAt: Date;
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Contract not found.');

// Contract reads (rentals task 5.1, api-design 02, 03, 18). A member reads only its own
// organization's contracts, and another organization's contract answers 404 (FR-AUTH-11,
// REQ-ERR-06); the organization comes from the verified token.
@Injectable()
export class ContractReadsService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
    private readonly devices: DevicesService,
    private readonly balances: BalanceService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  async page(
    query: ContractQuery,
    caller: Caller,
  ): Promise<PagedResult<{ row: ContractListRow } & ContractLabels>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.contracts.page(
      {
        organizationId: caller.organizationId ?? query.organizationId,
        status: query.status,
        planType: query.planType,
      },
      page.skip,
      page.take,
    );
    const label = await this.labeller(rows);
    return toPagedResult(
      rows.map((row) => ({ row, ...label(row) })),
      total,
      page,
    );
  }

  async detail(id: string, caller: Caller, at: Date = new Date()): Promise<ContractDetail> {
    const row = await this.visible(id, caller);
    const [label, assetTags, returnChecks, balance] = await Promise.all([
      this.labeller([row]),
      this.devices.assetTags(row.devices.map((device) => device.deviceId)),
      this.devices.returnChecks(
        row.devices.map((device) => ({
          contractDeviceId: device.id,
          deviceId: device.deviceId,
          checkedInAt: device.checkedInAt,
        })),
      ),
      this.balances.balanceSummary(id, at),
    ]);
    return { row, ...label(row), assetTags, returnChecks, balance };
  }

  async transitions(id: string, caller: Caller): Promise<TransitionView[]> {
    await this.visible(id, caller);
    const rows: TransitionRow[] = await this.contracts.transitionsOf(id);
    const actorOf = await resolveActors(
      this.directory,
      rows.map((row) => row.actorId),
    );
    return rows.map((row) => ({
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actor: actorOf(row.actorId)?.fullName ?? null,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  // Organization and variant labels for a set of contracts, read once.
  async labeller(
    rows: readonly { organizationId: string; hardwareVariantId: string }[],
  ): Promise<(row: { organizationId: string; hardwareVariantId: string }) => ContractLabels> {
    const [organizations, variants] = await Promise.all([
      this.organizations.labelsOf(rows.map((row) => row.organizationId)),
      this.devices.variants(false),
    ]);
    const variantCode = new Map(variants.map((variant) => [variant.id, variant.code]));
    return (row) => ({
      organization: organizations.get(row.organizationId) ?? null,
      variantCode: variantCode.get(row.hardwareVariantId) ?? null,
    });
  }

  private async visible(id: string, caller: Caller): Promise<ContractDetailRow> {
    const row = await this.contracts.detail(id);
    if (!row) throw notFound();
    if (caller.organizationId !== null && caller.organizationId !== row.organizationId) {
      throw notFound();
    }
    return row;
  }
}
