import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceStatus, LossCaseState, LossCustody, LossDecision, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { PagedResult, pagingBoundsFrom, resolvePage, toPagedResult } from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { ChannelKeyService, OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { LossCaseNotifier } from './loss-case-notifier';
import { LossCaseRow, LossCasesRepository } from './loss-cases.repository';
import { CUSTODY_RESOLVER, CustodyResolver } from './ports/custody-resolver.port';
import { LossCaseView } from './ports/loss-case-listener.port';
import {
  LOSS_ORGANIZATION_ACTIONS,
  LossOrganizationActions,
} from './ports/loss-organization-actions.port';

export const LOSS_CASE_REPORTED = 'lossCase.reported';

export interface LossCaseReportedEvent {
  lossCaseId: string;
  code: string;
  assetTag: string;
  // True when an Org Manager reported it, false for TrekLink Staff.
  byOrganization: boolean;
}

// devices api-design 17 to 22 and 27: the loss case as the API returns it.
export interface LossCaseDto {
  id: string;
  code: string;
  device: { id: string; assetTag: string };
  state: LossCaseState;
  stateFromDevice: DeviceStatus;
  reportedAt: Date;
  description: string;
  lastSeenAt: Date | null;
  lastPosition: { lat: number; lon: number } | null;
  custody: LossCustody | null;
  contractDeviceId: string | null;
  organization: { id: string; code: string } | null;
  keyExposed: boolean;
  // TrekLink callers only: omitted for an organization caller (leader ruling 2026-10-31, screen 4.4).
  suspectedTheft?: boolean;
  policeReference?: string | null;
  searchEndsAt: Date | null;
  triagedById: string | null;
  decision: LossDecision | null;
  chargeVnd: number | null;
  version: number;
}

// The six working states a device is reported lost from (REQ-EVT-13, design §2).
export const IN_SERVICE: readonly DeviceStatus[] = [
  DeviceStatus.IN_INTAKE,
  DeviceStatus.AVAILABLE,
  DeviceStatus.RESERVED,
  DeviceStatus.RENTED,
  DeviceStatus.RETURNED,
  DeviceStatus.MAINTENANCE,
];

const RECOVERABLE: readonly LossCaseState[] = [
  LossCaseState.REPORTED,
  LossCaseState.SEARCHING,
  LossCaseState.SETTLED,
];

const DAY_MS = 86_400_000;

type CustodyInterval = NonNullable<Awaited<ReturnType<CustodyResolver['custodyAt']>>>;

const notFound = (what: 'Device' | 'Loss case') =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found.`);

const wrongState = (state: string) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${state}.`,
  );

const staleVersion = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_VERSION,
    'This was changed by someone else. Reload and try again.',
  );

const lossCaseOpen = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.LOSS_CASE_OPEN,
    'This device is already reported lost.',
  );

const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);

// The violation of `loss_cases_one_open_per_device` alone (BR-37). Prisma names a partial index it
// cannot map to the schema by its name, or by its columns; any other unique violation, such as a
// duplicate `code`, is not a concurrent report and stays unmapped.
const isOneOpenViolation = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return (
    target === 'loss_cases_one_open_per_device' ||
    (Array.isArray(target) && target.length === 1 && target[0] === 'deviceId')
  );
};

// The custody interval a RENTER case charges and closes; null for TREKLINK custody or before triage.
const custodyContractOf = (row: LossCaseRow): LossCaseView['custodyContract'] =>
  row.custody === LossCustody.RENTER &&
  row.contractId !== null &&
  row.organizationId !== null &&
  row.contractDeviceId !== null
    ? {
        contractId: row.contractId,
        organizationId: row.organizationId,
        contractDeviceId: row.contractDeviceId,
      }
    : null;

export const toListenerView = (row: LossCaseRow): LossCaseView => ({
  id: row.id,
  code: row.code,
  deviceId: row.deviceId,
  assetTag: row.device.assetTag,
  custody: row.custody,
  custodyContract: custodyContractOf(row),
  confirmedAt: row.confirmedAt,
  chargeVnd: row.chargeVnd,
  decisionReason: row.decisionReason,
  decidedById: row.decidedById,
  settledAt: row.settledAt,
});

// Loss cases (task 2.7, design §2.1, D-045; UC-49, UC-60): report, triage by custody, recover,
// confirm by Staff or the `devices.lossSearch` job, and the Admin settlement. Every write is one
// transaction with a compare-and-set on the case's state and version; the device moves through
// DevicesRepository with one DeviceTransition row in the same transaction. Billing and rentals react
// through LOSS_CASE_LISTENERS inside that transaction (design §3); audit records and notifications go
// out after commit.
@Injectable()
export class LossCaseService {
  constructor(
    private readonly cases: LossCasesRepository,
    private readonly devices: DevicesRepository,
    private readonly fleet: DevicesService,
    private readonly organizations: OrganizationsService,
    private readonly parameters: ParameterService,
    private readonly notifier: LossCaseNotifier,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Inject(CUSTODY_RESOLVER) private readonly custody: CustodyResolver,
    private readonly channelKeys: ChannelKeyService,
    @Inject(LOSS_ORGANIZATION_ACTIONS) private readonly orgActions: LossOrganizationActions,
  ) {}

  // api-design 18: newest first; an organization caller sees its own organization's cases only.
  async list(
    query: { state?: LossCaseState; pageNumber?: number; pageSize?: number },
    caller: Caller,
  ): Promise<PagedResult<LossCaseDto>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.cases.page(
      {
        state: query.state,
        ...(caller.organizationId !== null ? { organizationId: caller.organizationId } : {}),
      },
      page.skip,
      page.take,
    );
    return toPagedResult(await this.views(rows, caller), total, page);
  }

  // api-design 27: another organization's case answers 404 (auth REQ-ERR-06).
  async get(id: string, caller: Caller): Promise<LossCaseDto> {
    const row = await this.cases.find(id);
    if (!row || !this.visibleTo(row, caller)) throw notFound('Loss case');
    return (await this.views([row], caller))[0];
  }

  // api-design 17 (REQ-EVT-13, REQ-ERR-05, BR-37): an Org Manager reports a device its organization
  // has in custody now; Staff report any device in service. The device moves to LOST from the state it
  // was in and one case opens REPORTED with the device's last seen time and position. The custody at
  // the report time names the organization, so the Manager sees the case at once; triage decides the
  // custody that counts, at the last seen time.
  async report(
    deviceId: string,
    dto: { description: string },
    caller: Caller,
    at: Date = new Date(),
  ): Promise<LossCaseDto> {
    const row = await this.events.transaction(async (tx) => {
      const unit = await this.devices.findDetail(deviceId, tx);
      if (!unit) throw notFound('Device');
      const holder = await this.custody.custodyAt(deviceId, at, tx);
      if (caller.organizationId !== null && holder?.organizationId !== caller.organizationId) {
        throw notFound('Device');
      }
      if (await this.devices.hasOpenLossCase(deviceId, tx)) throw lossCaseOpen();
      if (!IN_SERVICE.includes(unit.status)) throw wrongState(unit.status);

      const moved = await this.devices.moveIfCurrent(
        deviceId,
        unit.version,
        [unit.status],
        DeviceStatus.LOST,
        at,
        tx,
      );
      if (!moved) throw staleVersion();

      let created: LossCaseRow;
      try {
        created = await this.cases.insert(
          {
            code: await this.cases.nextCode(tx),
            deviceId,
            state: LossCaseState.REPORTED,
            stateFromDevice: unit.status,
            reportedById: caller.id,
            reportedAt: at,
            description: dto.description.trim(),
            lastSeenAt: unit.lastSeenAt,
            lastLatitude: unit.lastLatitude,
            lastLongitude: unit.lastLongitude,
            contractDeviceId: holder?.contractDeviceId ?? null,
            contractId: holder?.contractId ?? null,
            organizationId: holder?.organizationId ?? null,
          },
          tx,
        );
      } catch (error) {
        // loss_cases_one_open_per_device: a concurrent report won the race (BR-37).
        if (isOneOpenViolation(error)) throw lossCaseOpen();
        throw error;
      }
      await this.devices.insertTransition(
        {
          deviceId,
          fromStatus: unit.status,
          toStatus: DeviceStatus.LOST,
          actorId: caller.id,
          reason: 'LOSS_REPORTED',
          note: created.code,
          refType: 'LOSS_CASE',
          refId: created.id,
          createdAt: at,
        },
        tx,
      );
      this.audit(caller, created, 'lossCase.report', null, {
        state: created.state,
        stateFromDevice: created.stateFromDevice,
      });
      this.events.emitAfterCommit(LOSS_CASE_REPORTED, {
        lossCaseId: created.id,
        code: created.code,
        assetTag: created.device.assetTag,
        byOrganization: caller.organizationId !== null,
      } satisfies LossCaseReportedEvent);
      return created;
    });
    return (await this.views([row], caller))[0];
  }

  // api-design 19 (REQ-EVT-14, FR-DEV-13, D-040, D-046): custody from `custodyOf` below, RENTER or
  // TREKLINK; a RENTER
  // case marks the organization's channel key exposed (`ChannelKeyService.markKeyExposed`), and a
  // suspected theft or fraud of a renter opens or links a compliance case through
  // LOSS_ORGANIZATION_ACTIONS. The search window starts.
  async triage(
    id: string,
    dto: { suspectedTheft: boolean; policeReference?: string | null; expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<LossCaseDto> {
    const row = await this.events.transaction(async (tx) => {
      const current = await this.load(id, tx);
      if (current.state !== LossCaseState.REPORTED) throw wrongState(current.state);
      if (current.version !== dto.expectedVersion) throw staleVersion();

      const interval = await this.custodyOf(current, tx);
      const custody = interval ? LossCustody.RENTER : LossCustody.TREKLINK;
      const policeReference = dto.policeReference?.trim() || null;
      // REQ-EVT-14: in the triage transaction; organizations tells the Managers after commit.
      if (interval) await this.channelKeys.markKeyExposed(interval.organizationId, at, actor, tx);
      const complianceCaseId =
        interval && dto.suspectedTheft
          ? await this.orgActions.openOrLinkComplianceCase(
              {
                organizationId: interval.organizationId,
                lossCaseId: current.id,
                lossCaseCode: current.code,
                evidence: current.description,
                policeReference,
                actorId: actor.id,
              },
              tx,
            )
          : null;
      const days = await this.parameters.get('devices.lossSearchDays', tx);

      const updated = await this.cases.transition(
        id,
        LossCaseState.REPORTED,
        current.version,
        {
          state: LossCaseState.SEARCHING,
          custody,
          contractDeviceId: interval?.contractDeviceId ?? null,
          contractId: interval?.contractId ?? null,
          // A TREKLINK custody case keeps the reporting organization, so its Manager still sees it.
          organizationId: interval?.organizationId ?? current.organizationId,
          keyExposed: interval !== null,
          suspectedTheft: dto.suspectedTheft,
          policeReference,
          complianceCaseId,
          triagedById: actor.id,
          triagedAt: at,
          searchEndsAt: new Date(at.getTime() + days * DAY_MS),
        },
        tx,
      );
      if (!updated) throw staleVersion();
      this.audit(
        actor,
        updated,
        'lossCase.triage',
        { state: current.state },
        {
          state: updated.state,
          custody,
          keyExposed: updated.keyExposed,
          suspectedTheft: updated.suspectedTheft,
        },
      );
      return updated;
    });
    return (await this.views([row], actor))[0];
  }

  // api-design 21 (REQ-EVT-15): Staff confirm a SEARCHING case.
  async confirm(
    id: string,
    dto: { expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<LossCaseDto> {
    const row = await this.events.transaction(async (tx) => {
      const current = await this.load(id, tx);
      if (current.state !== LossCaseState.SEARCHING) throw wrongState(current.state);
      if (current.version !== dto.expectedVersion) throw staleVersion();
      const confirmed = await this.confirmIn(current, actor, at, tx);
      if (!confirmed) throw staleVersion();
      return confirmed;
    });
    return (await this.views([row], actor))[0];
  }

  // The `devices.lossSearch` job: confirms one SEARCHING case whose window has passed, as SYSTEM.
  // False when it is no longer due, for example because Staff confirmed or recovered it meanwhile.
  async confirmDue(id: string, at: Date): Promise<boolean> {
    return this.events.transaction(async (tx) => {
      const current = await this.cases.find(id, tx);
      if (
        !current ||
        current.state !== LossCaseState.SEARCHING ||
        current.searchEndsAt === null ||
        current.searchEndsAt > at
      ) {
        return false;
      }
      return (await this.confirmIn(current, null, at, tx)) !== null;
    });
  }

  // CONFIRMED with the charge raised: the device's remaining value at the confirmation time for a
  // RENTER case (FR-BILL-05, BR-25), none for TREKLINK custody. Every LOSS_CASE_LISTENERS.onConfirmed
  // runs inside this transaction, through which billing adds the LOSS line.
  private async confirmIn(
    current: LossCaseRow,
    actor: Caller | null,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<LossCaseRow | null> {
    const chargeVnd =
      custodyContractOf(current) !== null ? await this.fleet.valueAt(current.deviceId, at) : null;
    const updated = await this.cases.transition(
      current.id,
      LossCaseState.SEARCHING,
      current.version,
      { state: LossCaseState.CONFIRMED, confirmedAt: at, chargeVnd },
      tx,
    );
    if (!updated) return null;
    await this.notifier.confirmed(toListenerView(updated), tx);
    this.audit(
      actor,
      updated,
      'lossCase.confirm',
      { state: current.state },
      {
        state: updated.state,
        chargeVnd,
      },
    );
    return updated;
  }

  // api-design 22 (REQ-EVT-16, REQ-ERR-06, FR-BILL-11, BR-39): an Admin who did not triage the case
  // settles it. A RENTER case is charged, reduced below the confirmed charge, or waived; a TREKLINK
  // case is written off (AC-05). Every LOSS_CASE_LISTENERS.onSettled runs in this transaction (billing
  // adjusts the LOSS line, rentals sets the row's lostAt), then the device moves LOST to RETIRED.
  async decide(
    id: string,
    dto: {
      decision: LossDecision;
      chargeVnd?: number | null;
      reason?: string | null;
      expectedVersion: number;
    },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<LossCaseDto> {
    const row = await this.events.transaction(async (tx) => {
      const current = await this.load(id, tx);
      if (current.state !== LossCaseState.CONFIRMED) throw wrongState(current.state);
      if (current.version !== dto.expectedVersion) throw staleVersion();
      if (current.triagedById === actor.id) {
        throw new DomainException(
          HttpStatus.FORBIDDEN,
          ErrorCode.SEPARATION_OF_DUTY,
          'A different Admin must settle this case.',
        );
      }
      const { chargeVnd, reason } = settlementOf(current, dto);

      const updated = await this.cases.transition(
        id,
        LossCaseState.CONFIRMED,
        current.version,
        {
          state: LossCaseState.SETTLED,
          decision: dto.decision,
          chargeVnd,
          decisionReason: reason,
          decidedById: actor.id,
          settledAt: at,
        },
        tx,
      );
      if (!updated) throw staleVersion();
      await this.notifier.settled(toListenerView(updated), dto.decision, tx);

      const unit = await this.devices.findUnit(current.deviceId, tx);
      if (!unit || unit.status !== DeviceStatus.LOST) throw wrongState(unit?.status ?? 'unknown');
      const moved = await this.devices.moveIfCurrent(
        unit.id,
        unit.version,
        [DeviceStatus.LOST],
        DeviceStatus.RETIRED,
        at,
        tx,
        { retiredAt: at },
      );
      if (!moved) throw staleVersion();
      await this.devices.insertTransition(
        {
          deviceId: unit.id,
          fromStatus: DeviceStatus.LOST,
          toStatus: DeviceStatus.RETIRED,
          actorId: actor.id,
          reason: 'LOSS_SETTLED',
          note: `${updated.code} ${dto.decision}`,
          refType: 'LOSS_CASE',
          refId: updated.id,
          createdAt: at,
        },
        tx,
      );
      this.audit(
        actor,
        updated,
        'lossCase.settle',
        { state: current.state },
        {
          state: updated.state,
          decision: dto.decision,
          chargeVnd,
          reason,
        },
      );
      return updated;
    });
    return (await this.views([row], actor))[0];
  }

  // api-design 20 (REQ-EVT-11, FR-DEV-14, BR-38, E05-10): the device is back. The case moves to
  // RECOVERED, or stays SETTLED with the recovery time; the device moves to RETURNED from LOST, or from
  // RETIRED after settlement, and is reset and inspected like any return before it can be rented.
  async recover(
    id: string,
    dto: { note: string; expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<LossCaseDto> {
    const row = await this.events.transaction(async (tx) => {
      const current = await this.load(id, tx);
      const settled = current.state === LossCaseState.SETTLED;
      if (!RECOVERABLE.includes(current.state) || (settled && current.recoveredAt !== null)) {
        throw wrongState(current.state);
      }
      if (current.version !== dto.expectedVersion) throw staleVersion();

      const updated = await this.cases.transition(
        id,
        current.state,
        current.version,
        { state: settled ? LossCaseState.SETTLED : LossCaseState.RECOVERED, recoveredAt: at },
        tx,
      );
      if (!updated) throw staleVersion();

      const from = settled ? DeviceStatus.RETIRED : DeviceStatus.LOST;
      const unit = await this.devices.findUnit(current.deviceId, tx);
      if (!unit || unit.status !== from) throw wrongState(unit?.status ?? 'unknown');
      const moved = await this.devices.moveIfCurrent(
        unit.id,
        unit.version,
        [from],
        DeviceStatus.RETURNED,
        at,
        tx,
        settled ? { retiredAt: null } : {},
      );
      if (!moved) throw staleVersion();
      await this.devices.insertTransition(
        {
          deviceId: unit.id,
          fromStatus: from,
          toStatus: DeviceStatus.RETURNED,
          actorId: actor.id,
          reason: 'LOSS_RECOVERED',
          note: dto.note.trim(),
          refType: 'LOSS_CASE',
          refId: updated.id,
          createdAt: at,
        },
        tx,
      );
      this.audit(
        actor,
        updated,
        'lossCase.recover',
        { state: current.state },
        {
          state: updated.state,
          note: dto.note.trim(),
        },
      );
      return updated;
    });
    return (await this.views([row], actor))[0];
  }

  // The custody a triage records (REQ-EVT-14, D-040, leader rulings 2026-10-31 and 2026-11-01): the
  // interval that holds the last seen time counts only when it is the same rental as the interval at
  // the report time; otherwise the custody at the report time counts. That is TREKLINK custody (null)
  // only when no rental holds the unit at the report time, so a unit last heard outside any rental (only
  // at provisioning, say) and with a renter at the report time is that renter's. A unit never heard is
  // read at the report time alone. Both reads run in the triage transaction `tx`.
  private async custodyOf(
    current: LossCaseRow,
    tx: Prisma.TransactionClient,
  ): Promise<CustodyInterval | null> {
    const atReport = await this.custody.custodyAt(current.deviceId, current.reportedAt, tx);
    if (current.lastSeenAt === null) return atReport;
    const atLastSeen = await this.custody.custodyAt(current.deviceId, current.lastSeenAt, tx);
    return atReport?.contractDeviceId === atLastSeen?.contractDeviceId ? atLastSeen : atReport;
  }

  private async load(id: string, tx: Prisma.TransactionClient): Promise<LossCaseRow> {
    const row = await this.cases.find(id, tx);
    if (!row) throw notFound('Loss case');
    return row;
  }

  private visibleTo(row: LossCaseRow, caller: Caller): boolean {
    return caller.organizationId === null || row.organizationId === caller.organizationId;
  }

  // `viewer` decides the theft fields: an organization caller never receives `suspectedTheft` or
  // `policeReference` (leader ruling 2026-10-31); TrekLink callers get both.
  private async views(rows: LossCaseRow[], viewer: Caller): Promise<LossCaseDto[]> {
    const trekLink = viewer.organizationId === null;
    const labels = await this.organizations.labelsOf(
      rows.flatMap((row) => (row.organizationId ? [row.organizationId] : [])),
    );
    return rows.map((row) => {
      const label = row.organizationId ? labels.get(row.organizationId) : undefined;
      return {
        id: row.id,
        code: row.code,
        device: { id: row.device.id, assetTag: row.device.assetTag },
        state: row.state,
        stateFromDevice: row.stateFromDevice,
        reportedAt: row.reportedAt,
        description: row.description,
        lastSeenAt: row.lastSeenAt,
        lastPosition:
          row.lastLatitude !== null && row.lastLongitude !== null
            ? { lat: row.lastLatitude, lon: row.lastLongitude }
            : null,
        custody: row.custody,
        contractDeviceId: row.contractDeviceId,
        organization: label ? { id: label.id, code: label.code } : null,
        keyExposed: row.keyExposed,
        ...(trekLink
          ? { suspectedTheft: row.suspectedTheft, policeReference: row.policeReference }
          : {}),
        searchEndsAt: row.searchEndsAt,
        triagedById: row.triagedById,
        decision: row.decision,
        chargeVnd: row.chargeVnd,
        version: row.version,
      };
    });
  }

  private audit(
    actor: Caller | null,
    row: LossCaseRow,
    action: string,
    before: unknown,
    after: unknown,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor?.id ?? null,
      actorRoles: actor?.roles ?? [],
      organizationId: row.organizationId,
      action,
      subjectType: 'LossCase',
      subjectId: row.id,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}

// The charge and reason a settlement records (api-design 22). 400 for a decision that does not fit
// the custody, a reduction not below the confirmed charge, or a missing reason.
export const settlementOf = (
  row: Pick<
    LossCaseRow,
    'custody' | 'contractId' | 'organizationId' | 'contractDeviceId' | 'chargeVnd'
  >,
  dto: { decision: LossDecision; chargeVnd?: number | null; reason?: string | null },
): { chargeVnd: number | null; reason: string | null } => {
  const renter = custodyContractOf(row as LossCaseRow) !== null;
  const reason = dto.reason?.trim() || null;
  if (dto.decision !== LossDecision.CHARGED && reason === null) {
    throw invalid('reason is required unless the charge is kept.');
  }
  if (!renter) {
    if (dto.decision !== LossDecision.WRITTEN_OFF) {
      throw invalid('A loss in TrekLink custody is written off.');
    }
    return { chargeVnd: null, reason };
  }
  const confirmed = row.chargeVnd ?? 0;
  switch (dto.decision) {
    case LossDecision.CHARGED:
      return { chargeVnd: confirmed, reason };
    case LossDecision.REDUCED:
      if (dto.chargeVnd === undefined || dto.chargeVnd === null) {
        throw invalid('chargeVnd is required for a reduction.');
      }
      if (dto.chargeVnd >= confirmed) {
        throw invalid('A reduced charge must be lower than the confirmed charge.');
      }
      return { chargeVnd: dto.chargeVnd, reason };
    case LossDecision.WAIVED:
      return { chargeVnd: 0, reason };
    default:
      throw invalid('A loss in renter custody is charged, reduced or waived.');
  }
};
