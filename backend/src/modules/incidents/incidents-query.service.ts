import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Incident, IncidentState, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ContractsService } from '../rentals';
import { IncidentsRepository } from './incidents.repository';

export interface IncidentListQuery extends PagedQueryDto {
  state?: IncidentState[];
  open?: boolean;
  deviceId?: string;
  from?: Date;
}

export interface PersonRef {
  id: string;
  fullName: string | null;
}

// The incident body of api-design 01 to 07.
export interface IncidentView {
  id: string;
  code: string;
  device: {
    id: string;
    assetTag: string | null;
    holder: { name: string; phone: string | null } | null;
  };
  organizationId: string | null;
  contractId: string | null;
  state: IncidentState;
  stateChangedAt: Date;
  source: Incident['source'];
  confidence: Incident['confidence'];
  firstEventAt: Date;
  lastEventAt: Date;
  eventCount: number;
  lastPosition: { lat: number; lon: number } | null;
  stale: boolean;
  owner: PersonRef | null;
  tierDeadlineAt: Date | null;
  statusDueAt: Date | null;
  reopenCount: number;
  version: number;
}

export interface IncidentDetailView extends IncidentView {
  statusUpdates: { id: string; note: string; author: PersonRef; createdAt: Date }[];
  authorityReports: {
    id: string;
    agency: string;
    reference: string;
    reportedAt: Date;
    caseClosedAt: Date | null;
  }[];
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.');

// Task 5.1, the reads of api-design 01 and 02 (FR-AUTH-11). A member sees the routed organization's
// incidents only; another organization's incident answers 404. TrekLink Staff see every incident.
@Injectable()
export class IncidentsQueryService {
  constructor(
    private readonly repository: IncidentsRepository,
    private readonly devices: DevicesService,
    private readonly contracts: ContractsService,
    private readonly organizations: OrganizationsService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async list(query: IncidentListQuery, caller: Caller): Promise<PagedResult<IncidentView>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const state: Prisma.EnumIncidentStateFilter = {};
    if (query.state?.length) state.in = query.state;
    if (query.open) state.not = 'CLOSED';
    const where: Prisma.IncidentWhereInput = {
      ...(caller.organizationId !== null ? { organizationId: caller.organizationId } : {}),
      ...(Object.keys(state).length ? { state } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.from ? { createdAt: { gte: query.from } } : {}),
    };
    const [rows, total] = await this.repository.page(where, page.skip, page.take);
    return toPagedResult(await this.views(rows), total, page);
  }

  async detail(id: string, caller: Caller): Promise<IncidentDetailView> {
    const incident = await this.repository.findById(id);
    if (
      !incident ||
      (caller.organizationId !== null && incident.organizationId !== caller.organizationId)
    )
      throw notFound();
    const [updates, reports] = await Promise.all([
      this.repository.statusUpdates(id),
      this.repository.authorityReports(id),
    ]);
    const names = await this.organizations.memberNames(updates.map((update) => update.authorId));
    const [view] = await this.views([incident]);
    return {
      ...view,
      statusUpdates: updates.map(({ id: updateId, note, authorId, createdAt }) => ({
        id: updateId,
        note,
        author: { id: authorId, fullName: names.get(authorId) ?? null },
        createdAt,
      })),
      authorityReports: reports,
    };
  }

  // Device asset tag, holder label and owner name for each row, in three batched reads.
  async views(rows: Incident[]): Promise<IncidentView[]> {
    const [tags, holders, names] = await Promise.all([
      this.devices.assetTags([...new Set(rows.map((row) => row.deviceId))]),
      this.contracts.holderLabels(
        rows.flatMap((row) =>
          row.contractId ? [{ contractId: row.contractId, deviceId: row.deviceId }] : [],
        ),
      ),
      this.organizations.memberNames(rows.flatMap((row) => (row.ownerId ? [row.ownerId] : []))),
    ]);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      device: {
        id: row.deviceId,
        assetTag: tags.get(row.deviceId) ?? null,
        holder: holders.get(`${row.contractId}:${row.deviceId}`) ?? null,
      },
      organizationId: row.organizationId,
      contractId: row.contractId,
      state: row.state,
      stateChangedAt: row.stateChangedAt,
      source: row.source,
      confidence: row.confidence,
      firstEventAt: row.firstEventAt,
      lastEventAt: row.lastEventAt,
      eventCount: row.eventCount,
      lastPosition:
        row.lastLatitude !== null && row.lastLongitude !== null
          ? { lat: row.lastLatitude, lon: row.lastLongitude }
          : null,
      stale: row.stale,
      owner: row.ownerId ? { id: row.ownerId, fullName: names.get(row.ownerId) ?? null } : null,
      tierDeadlineAt: row.tierDeadlineAt,
      statusDueAt: row.statusDueAt,
      reopenCount: row.reopenCount,
      version: row.version,
    }));
  }
}
