import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AlertChannel,
  AlertKind,
  AlertStatus,
  Incident,
  IncidentState,
  Prisma,
} from '@prisma/client';
import { subject } from '@casl/ability';
import { Caller, PolicyAbility } from '../../common/decorators/access.decorator';
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
import { responseTimesOf, type ResponseTimeRow } from './response-times';
import { INCIDENT_EVENTS, EpisodeEvent, IncidentEvents } from './ports/incident-events.port';

export interface IncidentListQuery extends PagedQueryDto {
  state?: IncidentState[];
  open?: boolean;
  deviceId?: string;
  from?: Date;
}

// The open incident a monitoring read shows on a device (monitoring api-design 02 and 04). The
// routed organization lets a caller drop an incident another organization owns.
export interface OpenIncidentRef {
  id: string;
  code: string;
  state: IncidentState;
  organizationId: string | null;
}

// One incident of a device with its transitions, for the device history (monitoring api-design 07).
// Actors are account ids, which the history resolves to names with its other actors; a null actor is
// the system. `openedAt` is the incident's first event, the time of the opening when no transition
// records it.
export interface IncidentOfDevice {
  id: string;
  code: string;
  openedAt: Date;
  transitions: {
    fromState: IncidentState | null;
    toState: IncidentState;
    actorId: string | null;
    at: Date;
  }[];
}

export interface AlertDeliveryStats {
  pending: number;
  failed: number;
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
  // Opened by a simulated field event (demo design §9); the screens show a "Simulated" badge.
  simulated: boolean;
  version: number;
}

export interface IncidentDetailView extends IncidentView {
  // What the Operator reported on resolving; null until the incident is resolved (api-design 02).
  outcomeNote: string | null;
  // `correctsId` names the update this row corrects; `correctedById` names the row that corrects
  // this one. Both are null on an uncorrected original (dry run defect 15).
  statusUpdates: {
    id: string;
    note: string;
    author: PersonRef;
    createdAt: Date;
    correctsId: string | null;
    correctedById: string | null;
  }[];
  authorityReports: {
    id: string;
    agency: string;
    reference: string;
    reportedAt: Date;
    caseClosedAt: Date | null;
  }[];
}

// One row of the transition trail (api-design 12). `actor` is the person's name, or `SYSTEM`.
// `note` is the free text saved with the step (the response, the outcome, the false-alarm reason),
// null for a system step.
export interface TransitionView {
  seq: number;
  fromState: IncidentState | null;
  toState: IncidentState;
  actor: string;
  reason: string;
  note: string | null;
  createdAt: Date;
}

// One row of the alert delivery log (api-design 14). `recipient` is null for an organization
// API event, which has no person. `kind` tells an SOS transition alert (`TRANSITION`) from the
// device-silent alert (`STALE`, MSG40, REQ-EVT-12).
export interface AlertDeliveryView {
  kind: AlertKind;
  tier: string;
  recipient: string | null;
  channel: AlertChannel;
  status: AlertStatus;
  attempts: number;
  sentAt: Date | null;
  lastError: string | null;
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.');
// An organization id no row carries. Only an unconditioned `read Incident` rule (`incident.read`,
// TrekLink Staff and Admin) matches it; `incident.read.own` matches the caller's organization only.
const ANY_ORGANIZATION = '*any organization*';

// The organization filter of the reads, decided by the caller's CASL ability (FR-AUTH-11, PR #114
// review): an unconditioned rule reads every organization, `incident.read.own` reads the caller's
// own. An account with no organization and no unconditioned rule is refused, so a missing
// membership never widens the read to every organization.
// The alert log reads the same way through `alertDelivery.read` and `alertDelivery.read.own`, which
// only an Org Manager holds among members (api-design 14), so an Operator is refused 403.
const readScope = (
  ability: PolicyAbility,
  caller: Caller,
  model: 'Incident' | 'AlertDelivery' = 'Incident',
): { organizationId?: string } => {
  if (ability.can('read', subject(model, { organizationId: ANY_ORGANIZATION }))) return {};
  const { organizationId } = caller;
  if (organizationId !== null && ability.can('read', subject(model, { organizationId })))
    return { organizationId };
  throw new DomainException(
    HttpStatus.FORBIDDEN,
    ErrorCode.FORBIDDEN,
    'You do not have access to this.',
  );
};

// Task 5.1, the reads of api-design 01, 02, 12, 13 and 14 (FR-AUTH-11). A member sees the routed organization's
// incidents only; another organization's incident answers 404. TrekLink Staff see every incident.
@Injectable()
export class IncidentsQueryService {
  constructor(
    private readonly repository: IncidentsRepository,
    private readonly devices: DevicesService,
    private readonly contracts: ContractsService,
    private readonly organizations: OrganizationsService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Inject(INCIDENT_EVENTS) private readonly episodeEvents: IncidentEvents,
  ) {}

  // --- monitoring reads (design §5), `openByDevices(ids)` -------------------------------------------
  // The incident not yet CLOSED on each device, keyed by device id, the newest when a device has more
  // than one. Scoping is the caller's: monitoring keeps only its organization's routed incidents.
  async openByDevices(ids: readonly string[]): Promise<Map<string, OpenIncidentRef>> {
    const open = new Map<string, OpenIncidentRef>();
    if (ids.length === 0) return open;
    for (const row of await this.repository.openOfDevices(ids)) {
      if (open.has(row.deviceId)) continue;
      open.set(row.deviceId, {
        id: row.id,
        code: row.code,
        state: row.state,
        organizationId: row.organizationId,
      });
    }
    return open;
  }
  // Every incident of one device, oldest first, with its transitions (design §5, api-design 07). No
  // scoping: the device history is TrekLink staff's.
  async incidentsOfDevice(deviceId: string): Promise<IncidentOfDevice[]> {
    const rows = await this.repository.incidentsOfDevice(deviceId);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      openedAt: row.firstEventAt,
      transitions: row.transitions.map(({ createdAt, ...step }) => ({ ...step, at: createdAt })),
    }));
  }

  // The alert outbox on the system health page (design §5, api-design 06): rows still waiting to be sent
  // and rows whose retries ran out. SENT rows are not counted.
  async alertDeliveryStats(): Promise<AlertDeliveryStats> {
    const counts = await this.repository.alertDeliveryCounts();
    return {
      pending: counts.get(AlertStatus.PENDING) ?? 0,
      failed: counts.get(AlertStatus.FAILED) ?? 0,
    };
  }
  // Time to acknowledge and to resolve per organization over [from, to) by the first event, as medians and
  // 95th percentiles (design §5, monitoring api-design 08, incident-times). The range is the caller's to
  // bound.
  async responseTimes(range: { from: Date; to: Date }): Promise<ResponseTimeRow[]> {
    return responseTimesOf(await this.repository.responseTimeRows(range.from, range.to));
  }
  // --- end monitoring reads ---------------------------------------------------------------------------

  async list(
    query: IncidentListQuery,
    caller: Caller,
    ability: PolicyAbility,
  ): Promise<PagedResult<IncidentView>> {
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
      ...readScope(ability, caller),
      ...(Object.keys(state).length ? { state } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.from ? { createdAt: { gte: query.from } } : {}),
    };
    const [rows, total] = await this.repository.page(where, page.skip, page.take);
    return toPagedResult(await this.views(rows), total, page);
  }

  async detail(id: string, caller: Caller, ability: PolicyAbility): Promise<IncidentDetailView> {
    const incident = await this.readable(id, readScope(ability, caller));
    const [updates, reports] = await Promise.all([
      this.repository.statusUpdates(id),
      this.repository.authorityReports(id),
    ]);
    const names = await this.organizations.memberNames(updates.map((update) => update.authorId));
    const [view] = await this.views([incident]);
    return {
      ...view,
      outcomeNote: incident.outcomeNote,
      statusUpdates: updates.map(
        ({ id: updateId, note, authorId, createdAt, correctsId, correctedBy }) => ({
          id: updateId,
          note,
          author: { id: authorId, fullName: names.get(authorId) ?? null },
          createdAt,
          correctsId,
          correctedById: correctedBy?.id ?? null,
        }),
      ),
      authorityReports: reports,
    };
  }

  // API 13: authorize the incident before the port reads gateway-sync's event ledger.
  async events(id: string, caller: Caller, ability: PolicyAbility): Promise<EpisodeEvent[]> {
    const scope = readScope(ability, caller);
    await this.readable(id, scope);
    return this.episodeEvents.eventsOfIncident(id, scope);
  }

  // api-design 12, FR-INC-04, BR-18.
  async transitions(id: string, caller: Caller, ability: PolicyAbility): Promise<TransitionView[]> {
    await this.readable(id, readScope(ability, caller));
    const rows = await this.repository.transitions(id);
    const names = await this.organizations.memberNames(
      rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
    );
    return rows.map(({ actorId, note, ...row }) => ({
      ...row,
      note: note ?? null,
      actor: actorId === null ? 'SYSTEM' : (names.get(actorId) ?? actorId),
    }));
  }

  // api-design 14, FR-INC-12, E03-7.
  async alerts(id: string, caller: Caller, ability: PolicyAbility): Promise<AlertDeliveryView[]> {
    await this.readable(id, readScope(ability, caller, 'AlertDelivery'));
    const rows = await this.repository.alertDeliveries(id);
    const names = await this.organizations.memberNames(
      rows.flatMap((row) => (row.recipientId ? [row.recipientId] : [])),
    );
    return rows.map(({ recipientId, ...row }) => ({
      ...row,
      recipient: recipientId === null ? null : (names.get(recipientId) ?? recipientId),
    }));
  }

  // The incident when the read scope covers it; a missing one or another organization's is 404.
  private async readable(id: string, scope: { organizationId?: string }): Promise<Incident> {
    const incident = await this.repository.findById(id);
    if (
      !incident ||
      (scope.organizationId !== undefined && incident.organizationId !== scope.organizationId)
    )
      throw notFound();
    return incident;
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
      simulated: row.simulated,
      version: row.version,
    }));
  }
}
