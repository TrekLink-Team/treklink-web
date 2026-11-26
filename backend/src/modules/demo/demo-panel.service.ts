import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InspectionResult, PaymentMethod, PlanType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { errorCodeFor, mapPrismaError } from '../../common/filters/http-exception.filter';
import { DemoSessionService } from '../auth';
import { InvoicesService, PaymentsService } from '../billing';
import { DevicesService, MaintenanceService } from '../devices';
import { UplinkIngress } from '../gateway-sync';
import { IncidentsQueryService, IncidentsService, IncidentTimersJob } from '../incidents';
import { OrganizationOnboardingService, OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { demoDatabaseMatches, simulationDatabaseAllowed } from '../platform/config/database-url';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  ContractDecisionsService,
  ContractsService,
  HandoverService,
  ReturnService,
} from '../rentals';
import { PANEL_ACTIONS, PANEL_ACTION_VIEWS, PanelAction } from './demo-panel-actions';
import { PANEL_AUDIT_ROLE, PANEL_RUN_ACTOR } from './demo-panel.constants';
import { DemoPanelLock } from './demo-panel-lock';
import { nodePositionUplink } from './demo-position-packet';
import { DemoQuickRepository } from './demo-quick.repository';
import { quickOrganizationNames } from './demo-quick-names';
import { DEMO_REGISTRATION, SEEDED_EMAILS, SeededRole } from './demo-scenarios';
import type { StagedRecord } from './demo-scenarios.service';
import { nodeSosUplink } from './demo-sos-packet';

// Commands only the playback runs (REQ-PNL-08): MF-01a onboarding and the MF-02 positions.
export const PLAYBACK_COMMANDS = [
  'organization-register',
  'organization-verify',
  'field-positions',
] as const;
export type PlaybackCommand = (typeof PLAYBACK_COMMANDS)[number];
export type PanelCommand = PanelAction | PlaybackCommand;

export interface PanelInput {
  recordId?: string;
  expectedVersion?: number;
  deviceId?: string;
  organizationId?: string;
  hardwareVariantId?: string;
  quantity?: number;
}

export interface ActedAs {
  role: string;
  email: string | null;
}

// What a command leaves for the next playback step: the record it made or moved and its version.
export interface PanelContext {
  organizationId?: string;
  organizationCode?: string;
  contractId?: string;
  incidentId?: string;
  version?: number;
}

export interface PanelOutcome {
  actedAs: ActedAs | null;
  records: StagedRecord[];
  context?: PanelContext;
}

export interface PanelResult {
  action: PanelCommand;
  runId: number;
  label: string;
  actedAs: ActedAs | null;
  records: StagedRecord[];
  context: PanelContext;
}

interface Actor {
  caller: Caller;
  actedAs: ActedAs;
}

// The notes the playbook types on the real screens (docs/demo/2026-11-22-scenario-playbook.md §8, §10).
const NOTES = {
  responding: 'Ranger team dispatched from the Ta Nang post',
  outcome: 'Hiker found, minor ankle injury, walked out',
  falseAlarm: 'Demo panel: the button was pressed by mistake during the demo.',
  endNow: 'The trek season of the organization ended early.',
  cancel: 'Demo panel: a stale request removed before the demo.',
  maintenance: 'Demo panel: casing seal check before the next rental.',
  repaired: 'Demo panel: casing resealed and tested.',
};
// A synthetic PNG for a demo note, never a person's signature (as the W43 quick handover, REQ-QUICK-03).
const DEMO_SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
// The start of the Ta Nang to Phan Dung trail (the position fixture's point), where MF-02 places units.
const TA_NANG = { lat: 11.5544, lon: 108.5381 };
// The cost a demo repair records: devices api-design 14 requires actualCostVnd for COMPLETED. Zero stays
// at or below devices.maintenanceApprovalThresholdVnd, so the record completes and never goes back to
// PENDING_APPROVAL. A demo value, not a business number (D-110).
export const DEMO_REPAIR_COST_VND = 0;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// The seeded organization the playbook runs on.
const DEMO_ORGANIZATION = 'ORG-0001';
const DEMO_VARIANT = 'treklink-v3';
// The caller of the panel's own reads of another module (membership lists): TrekLink-wide, no account.
const PANEL_READER: Caller = { id: PANEL_RUN_ACTOR, roles: ['STAFF'], organizationId: null };

// The roles the panel may act as (D-110 rule 8, 2026-11-24): never ADMIN.
export type PanelSeededRole = Exclude<SeededRole, 'ADMIN'>;
const noAdmin = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.DEMO_SCENARIO_UNAVAILABLE,
    'The demo panel never acts as an Admin account. Use the Admin screen.',
  );

const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
const conflict = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.CONFLICT, code, message);
const notFound = (what: string) =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found.`);
const stale = () =>
  conflict(ErrorCode.STALE_VERSION, 'This was changed by someone else. Reload and try again.');

// The calendar day of `at` in UTC+7 as a UTC-midnight date, the shape of a @db.Date column.
const businessDay = (at: Date): Date =>
  new Date(`${new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);
const dueOf = (invoice: { totalVnd: bigint; paidVnd: bigint }) =>
  invoice.totalVnd > invoice.paidVnd ? invoice.totalVnd - invoice.paidVnd : 0n;
const incidentPath = (incident: { id: string; organizationId: string | null }) =>
  incident.organizationId ? `/o/incidents/${incident.id}` : `/t/incidents/${incident.id}`;

// Options, actions and the panel audit of the demo panel (specs/demo/requirements.md REQ-PNL-03,
// REQ-PNL-04, REQ-PNL-07, design §11, D-110). Every business step is a call into the owning module's
// exported service, acting as the account whose real screen the step stands for, so the state machines,
// versions, membership, stock, payment and custody rules of the real screens apply. Each command is one
// demo run (the W43 registry) and one `demo.panel.<command>` audit entry with no actor.
@Injectable()
export class DemoPanelService {
  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    private readonly events: TransactionalEvents,
    private readonly parameters: ParameterService,
    private readonly runs: DemoQuickRepository,
    private readonly sessions: DemoSessionService,
    private readonly organizations: OrganizationsService,
    private readonly onboarding: OrganizationOnboardingService,
    private readonly contracts: ContractsService,
    private readonly decisions: ContractDecisionsService,
    private readonly handover: HandoverService,
    private readonly returns: ReturnService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly devices: DevicesService,
    private readonly maintenance: MaintenanceService,
    private readonly uplinks: UplinkIngress,
    private readonly incidentReads: IncidentsQueryService,
    private readonly incidents: IncidentsService,
    private readonly timers: IncidentTimersJob,
    private readonly lock: DemoPanelLock,
  ) {}

  // REQ-PNL-13: a local or staging database (REQ-SIM-02), or the dedicated demo branch.
  writable(): boolean {
    return simulationDatabaseAllowed(this.config) || demoDatabaseMatches(this.config);
  }

  async overview() {
    const [incidents, contracts, invoices, devices, organizations, variants] = await Promise.all([
      this.incidentReads.panelOptions(),
      this.contracts.panelOptions(),
      this.invoices.panelOptions(),
      this.devices.panelOptions(),
      this.organizations.activeDemoOptions(),
      this.devices.variants(true),
    ]);
    return {
      writable: this.writable(),
      actions: PANEL_ACTION_VIEWS,
      options: {
        incidents,
        contracts,
        // Money as a decimal string, as the other money fields of the API (BigInt does not serialize).
        invoices: invoices.map(({ id, number, contractId, organizationId, ...amounts }) => ({
          id,
          number,
          contractId,
          organizationId,
          dueVnd: dueOf(amounts).toString(),
        })),
        devices: devices.map((device) => ({ ...device, nodeNum: Number(device.nodeNum) })),
        organizations,
        variants: variants.map(({ id, code, name }) => ({ id, code, name })),
      },
    };
  }

  // Route 14: only the catalogue's actions are reachable over HTTP; the playback commands are not.
  async runAction(action: string, input: PanelInput, client: string, now = new Date()) {
    if (!PANEL_ACTIONS.includes(action as PanelAction))
      throw invalid('Choose a listed panel action.');
    return this.run(action as PanelAction, input, client, now);
  }

  // Every action and playback step: refused with 409 DEMO_BUSY while a reseed runs, and counted as in
  // flight so a reseed cannot start under it (review of treklink-web#541).
  run(command: PanelCommand, input: PanelInput, client: string, now = new Date()) {
    return this.lock.action(() => this.runUnlocked(command, input, client, now));
  }

  private async runUnlocked(
    command: PanelCommand,
    input: PanelInput,
    client: string,
    now: Date,
  ): Promise<PanelResult> {
    this.validate(command, input);
    if (!this.writable())
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.DEMO_DATABASE_NOT_ALLOWED,
        'The demo panel writes only to a local, staging or demo database.',
      );
    const run = await this.runs.createRun(PANEL_RUN_ACTOR, `panel.${command}`);
    const label = `Demo ${run.id}`;
    let outcome: PanelOutcome = { actedAs: null, records: [] };
    let failure: DomainException | undefined;
    try {
      outcome = await this.execute(command, input, now, run.id);
    } catch (error) {
      failure = this.domainError(error);
    }
    const records = outcome.records.map((record) => ({ ...record }));
    await this.events.transaction(async (tx) => {
      await this.runs.saveRun(run.id, records, failure?.message ?? null, tx);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: null,
        actorRoles: [PANEL_AUDIT_ROLE],
        organizationId: null,
        action: `demo.panel.${command}`,
        subjectType: 'DemoScenarioRun',
        subjectId: String(run.id),
        after: {
          actedAs: outcome.actedAs,
          input: { ...input },
          records,
          error: failure?.message ?? null,
          errorCode: failure?.errorCode ?? null,
          demo: true,
        },
        ip: client,
      } satisfies AuditRecordEvent);
    });
    if (failure)
      throw new DomainException(failure.httpStatus, failure.errorCode, failure.message, {
        runId: run.id,
        label,
        records,
      });
    return {
      action: command,
      runId: run.id,
      label,
      actedAs: outcome.actedAs,
      records,
      context: outcome.context ?? {},
    };
  }

  private validate(command: PanelCommand, input: PanelInput) {
    const view = PANEL_ACTION_VIEWS.find((action) => action.id === command);
    const needs =
      view?.needs ??
      (command === 'organization-register' || command === 'field-positions'
        ? []
        : ['recordId', 'expectedVersion']);
    if (needs.includes('recordId') && !input.recordId) throw invalid('Choose the record first.');
    if (needs.includes('deviceId') && !input.deviceId) throw invalid('Choose a device first.');
    if (needs.includes('expectedVersion') && input.expectedVersion === undefined)
      throw invalid('Reload the record to supply expectedVersion.');
  }

  private domainError(error: unknown): DomainException {
    const cause = mapPrismaError(error) ?? error;
    if (cause instanceof DomainException) return cause;
    return new DomainException(
      cause instanceof HttpException ? cause.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
      cause instanceof HttpException ? errorCodeFor(cause) : ErrorCode.INTERNAL_ERROR,
      cause instanceof Error ? cause.message : 'Demo panel action failed. Inspect its records.',
    );
  }

  private execute(
    command: PanelCommand,
    input: PanelInput,
    now: Date,
    runId: number,
  ): Promise<PanelOutcome> {
    const id = input.recordId!;
    const version = input.expectedVersion!;
    switch (command) {
      case 'incident-sos':
        return this.sos(input.deviceId!, now);
      case 'incident-acknowledge':
        return this.incidentStep(id, 'member', (actor) =>
          this.incidents.acknowledge(id, { expectedVersion: version }, actor),
        );
      case 'incident-respond':
        return this.incidentStep(id, 'owner', (actor) =>
          this.incidents.responding(
            id,
            { expectedVersion: version, note: NOTES.responding },
            actor,
          ),
        );
      case 'incident-resolve':
        return this.incidentStep(id, 'owner', (actor) =>
          this.incidents.resolve(
            id,
            { expectedVersion: version, outcomeNote: NOTES.outcome },
            actor,
          ),
        );
      case 'incident-false-alarm':
        return this.incidentStep(id, 'staffIfUnrouted', (actor) =>
          this.incidents.falseAlarm(
            id,
            { expectedVersion: version, reason: NOTES.falseAlarm },
            actor,
          ),
        );
      case 'incident-close':
        return this.incidentClose(id, version, now);
      case 'contract-create':
        return this.contractCreate(input, now);
      case 'contract-approve':
        return this.contractApprove(id, version, now);
      case 'contract-handover':
        return this.contractHandover(id, version, now, runId);
      case 'contract-return':
        return this.contractReturn(id, version, now);
      case 'contract-close':
        return this.contractClose(id, version, now, runId);
      case 'contract-cancel':
        return this.contractCancel(id, version, now);
      case 'invoice-pay':
        return this.invoicePay(id, now, runId);
      case 'device-maintenance-open':
        return this.maintenanceOpen(input.deviceId!, version, now);
      case 'device-maintenance-complete':
        return this.maintenanceComplete(input.deviceId!, now);
      case 'organization-register':
        return this.organizationRegister(runId);
      case 'organization-verify':
        return this.organizationVerify(id, version, now, runId);
      case 'field-positions':
        return this.fieldPositions(input.organizationId, now);
    }
  }

  // --- actors (REQ-PNL-03) ---------------------------------------------------------------------------

  // Never the Admin (leader ruling 2026-11-24, "No Admin at all", D-110 rule 8): the type leaves
  // ADMIN out, and an account that holds the ADMIN role is refused at run time as well.
  private async seeded(role: PanelSeededRole): Promise<Actor> {
    const email = SEEDED_EMAILS[role];
    const user = await this.sessions.panelAccountOf(email);
    if (!user)
      throw conflict(
        ErrorCode.DEMO_SCENARIO_UNAVAILABLE,
        `The seeded ${role} account is missing or may not sign in. Reseed the demo data.`,
      );
    if (user.roles.includes('ADMIN')) throw noAdmin();
    return {
      caller: { id: user.id, roles: user.roles, organizationId: user.organization?.id ?? null },
      actedAs: { role, email: user.email },
    };
  }

  // A live member of the organization, the preferred role first: an account that has set its password
  // and is not deactivated, as the real screen's signed-in member would be.
  private async member(
    organizationId: string,
    prefer: 'OPERATOR' | 'MANAGER',
    userId?: string | null,
  ): Promise<Actor> {
    const members = (
      await this.organizations.membersOf(organizationId, false, PANEL_READER)
    ).filter((member) => member.deactivatedAt === null && !member.invitationPending);
    const chosen =
      (userId ? members.find((member) => member.userId === userId) : undefined) ??
      members.find((member) => member.role === prefer) ??
      members[0];
    if (!chosen)
      throw conflict(
        ErrorCode.DEMO_SCENARIO_UNAVAILABLE,
        'The organization has no live member to act for it. Add or reactivate one first.',
      );
    const role = `ORG_${chosen.role}`;
    return {
      caller: { id: chosen.userId, roles: [role], organizationId },
      actedAs: { role, email: chosen.email },
    };
  }

  // --- incidents ---------------------------------------------------------------------------------------

  private async incidentRecord(id: string) {
    const incident = await this.incidentReads.panelRecord(id);
    if (!incident) throw notFound('Incident');
    return incident;
  }

  private async incidentStep(
    id: string,
    who: 'member' | 'owner' | 'staffIfUnrouted',
    act: (actor: Caller) => Promise<{ id: string; code: string; state: string; version: number }>,
  ): Promise<PanelOutcome> {
    const incident = await this.incidentRecord(id);
    let actor: Actor;
    if (who === 'staffIfUnrouted' && incident.state === 'UNROUTED')
      actor = await this.seeded('STAFF');
    else if (!incident.organizationId)
      throw conflict(
        ErrorCode.INVALID_STATE_TRANSITION,
        `This cannot be done while it is ${incident.state}.`,
      );
    else
      actor = await this.member(
        incident.organizationId,
        'OPERATOR',
        who === 'owner' ? incident.ownerId : undefined,
      );
    const moved = await act(actor.caller);
    return {
      actedAs: actor.actedAs,
      records: [
        {
          label: `Incident, ${moved.state.toLowerCase().replace(/_/g, ' ')}`,
          code: moved.code,
          path: incidentPath(incident),
        },
      ],
      context: { incidentId: moved.id, version: moved.version },
    };
  }

  private async incidentClose(id: string, version: number, now: Date): Promise<PanelOutcome> {
    const incident = await this.incidentRecord(id);
    const closed = await this.timers.closeDemo(id, version, now);
    return {
      actedAs: null,
      records: [
        { label: 'Demo time: incident closed', code: closed.code, path: incidentPath(incident) },
      ],
      context: { incidentId: closed.id, version: closed.version },
    };
  }

  // A simulated SOS from a rented unit through the node uplink path (REQ-QUICK-04 shape). A second SOS
  // from the same unit joins its open incident, as a real node's does.
  private async sos(deviceId: string, now: Date): Promise<PanelOutcome> {
    const [device] = await this.devices.projections([deviceId]);
    const [custody] = await this.contracts.visibleDevices({
      organizationId: null,
      deviceIds: [deviceId],
    });
    if (!device || device.status !== 'RENTED' || !custody)
      throw conflict(
        ErrorCode.DEMO_SCENARIO_UNAVAILABLE,
        'Choose a unit that is rented and in live custody.',
      );
    if (device.nodeNum === null)
      throw conflict(ErrorCode.DEMO_SCENARIO_UNAVAILABLE, `${device.assetTag} has no node number.`);
    const { topic, body } = nodeSosUplink(Number(device.nodeNum), now, randomInt(1, 2 ** 31));
    await this.uplinks.ingest(topic, body, now, { simulated: true });
    const incident = (await this.incidentReads.openByDevices([deviceId])).get(deviceId);
    if (!incident)
      throw conflict(
        ErrorCode.DEMO_SCENARIO_UNAVAILABLE,
        'The SOS was ingested but opened no incident. Check the unit custody and the attribution margin.',
      );
    return {
      actedAs: null,
      records: [
        {
          label: `Simulated SOS, ${device.assetTag}`,
          code: incident.code,
          path: incidentPath(incident),
        },
      ],
      context: { incidentId: incident.id },
    };
  }

  // --- contracts ---------------------------------------------------------------------------------------

  private async contractRecord(id: string, version?: number) {
    const contract = await this.contracts.demoDetail(id);
    if (!contract) throw notFound('Contract');
    if (version !== undefined && contract.version !== version) throw stale();
    return contract;
  }

  private contractLinks(contract: { id: string; code: string }, label: string): StagedRecord[] {
    return [{ label, code: contract.code, path: `/t/contracts/${contract.id}` }];
  }

  private async contractCreate(input: PanelInput, now: Date): Promise<PanelOutcome> {
    const organizations = await this.organizations.activeDemoOptions();
    const organization = input.organizationId
      ? organizations.find((row) => row.id === input.organizationId)
      : (organizations.find((row) => row.code === DEMO_ORGANIZATION) ?? organizations[0]);
    if (!organization)
      throw conflict(ErrorCode.ORGANIZATION_NOT_ACTIVE, 'Choose an Active organization.');
    const variants = await this.devices.variants(true);
    const variant = input.hardwareVariantId
      ? variants.find((row) => row.id === input.hardwareVariantId)
      : (variants.find((row) => row.code === DEMO_VARIANT) ?? variants[0]);
    if (!variant) throw invalid('Choose an active hardware variant.');
    const quantity = input.quantity ?? (await this.parameters.get('rentals.minOrderQuantity'));
    const manager = await this.member(organization.id, 'MANAGER');
    const { contract } = await this.contracts.request(
      {
        planType: PlanType.MONTHLY,
        hardwareVariantId: variant.id,
        quantity,
        requestedStartDate: businessDay(now),
      },
      manager.caller,
      now,
    );
    return {
      actedAs: manager.actedAs,
      records: this.contractLinks(contract, 'Contract, requested'),
      context: {
        contractId: contract.id,
        organizationId: organization.id,
        version: contract.version,
      },
    };
  }

  private async contractApprove(id: string, version: number, now: Date): Promise<PanelOutcome> {
    const staff = await this.seeded('STAFF');
    // The next whole minute: an appointment before the current minute is refused (rentals REQ-ERR-09).
    const handoverAt = new Date((Math.floor(now.getTime() / MINUTE_MS) + 1) * MINUTE_MS);
    const { contract } = await this.decisions.approve(
      id,
      { handoverAt, expectedVersion: version },
      staff.caller,
      now,
    );
    return {
      actedAs: staff.actedAs,
      records: [
        ...this.contractLinks(contract, 'Contract, approved'),
        { label: 'Counter handover', code: contract.code, path: `/t/counter/${contract.id}` },
      ],
      context: { contractId: contract.id, version: contract.version },
    };
  }

  // The holding fee at the counter if due, every unit provisioned, then the handover with a synthetic
  // signature and the live Manager as signer, disclosed as REQ-QUICK-03 discloses it.
  private async contractHandover(
    id: string,
    version: number,
    now: Date,
    runId: number,
  ): Promise<PanelOutcome> {
    const contract = await this.contractRecord(id, version);
    const staff = await this.seeded('STAFF');
    const invoice = await this.invoices.firstChargeableInvoice(id);
    if (invoice) {
      const due = invoice.lines.reduce(
        (sum, line) => sum + (line.amountVnd > line.paidVnd ? line.amountVnd - line.paidVnd : 0n),
        0n,
      );
      if (due > 0n)
        await this.payments.recordCounter(
          invoice.id,
          { method: PaymentMethod.CASH, amountVnd: due, reference: `DEMO-PANEL-${runId}-HOLD` },
          staff.caller,
          now,
        );
    }
    const signer = await this.member(contract.organizationId, 'MANAGER');
    const key = await this.organizations.channelKeyState(contract.organizationId);
    for (const unit of contract.devices)
      await this.handover.provision(id, unit.deviceId, key.channelKeyVersion, staff.caller, now);
    const minBattery = await this.parameters.get('devices.handoverMinBatteryPct');
    const handed = await this.handover.complete(
      id,
      {
        signedByUserId: signer.caller.id,
        identityChecked: `Demo ${runId}: synthetic signature and manual provisioning, no physical handover`,
        signaturePng: DEMO_SIGNATURE,
        acknowledgeLowBattery: false,
        expectedVersion: version,
        deviceChecks: contract.devices.map((unit) => ({
          deviceId: unit.deviceId,
          batteryPct: Math.max(90, minBattery),
          gpsFixOk: true,
        })),
      },
      staff.caller,
      now,
    );
    return {
      actedAs: staff.actedAs,
      records: [
        ...this.contractLinks(contract, 'Contract, active'),
        { label: 'Handover note', code: contract.code, path: `/t/counter/${id}` },
      ],
      context: { contractId: id, version: handed.version },
    };
  }

  // MF-05: notice and End contract now as the Manager while the contract runs, then check-in, reset and
  // a passed inspection of every unit as Staff (playbook §10 steps 1 to 6).
  private async contractReturn(id: string, version: number, now: Date): Promise<PanelOutcome> {
    let contract = await this.contractRecord(id, version);
    let actedAs: ActedAs | null = null;
    let current = version;
    if (contract.status === 'ACTIVE' || contract.status === 'ENDING') {
      const manager = await this.member(contract.organizationId, 'MANAGER');
      actedAs = manager.actedAs;
      if (contract.status === 'ACTIVE' && contract.planType === PlanType.MONTHLY)
        current = (await this.decisions.giveNotice(id, current, manager.caller, now)).contract
          .version;
      await this.decisions.endNow(
        id,
        { reason: NOTES.endNow, expectedVersion: current },
        manager.caller,
        now,
      );
      contract = await this.contractRecord(id);
    } else if (contract.status !== 'RETURN_DUE') {
      throw conflict(
        ErrorCode.INVALID_STATE_TRANSITION,
        `This cannot be done while it is ${contract.status}.`,
      );
    }
    const staff = await this.seeded('STAFF');
    actedAs ??= staff.actedAs;
    const pending = contract.devices.filter(
      (unit) => unit.handedOverAt && !unit.checkedInAt && !unit.lostAt,
    );
    const tags = await this.devices.assetTags(pending.map((unit) => unit.deviceId));
    if (pending.length) await this.returns.checkIn(id, [...tags.values()], staff.caller, now);
    for (const unit of pending) {
      await this.events.transaction((tx) =>
        this.devices.reset(
          unit.deviceId,
          { keyRemoved: true, nodeDbCleared: true, ownerCleared: true },
          staff.caller.id,
          now,
          tx,
        ),
      );
      await this.returns.inspect(
        id,
        unit.deviceId,
        { result: InspectionResult.PASSED, damageCodes: [], note: null },
        staff.caller,
        now,
      );
    }
    const after = await this.contractRecord(id);
    return {
      actedAs,
      records: [
        ...this.contractLinks(after, `Contract, ${after.status.toLowerCase().replace(/_/g, ' ')}`),
        { label: 'Counter check-in', code: after.code, path: `/t/counter/${id}` },
      ],
      context: { contractId: id, version: after.version },
    };
  }

  // Every open balance paid at the counter as Staff, then the close (playbook §10 steps 8 to 10).
  private async contractClose(
    id: string,
    version: number,
    now: Date,
    runId: number,
  ): Promise<PanelOutcome> {
    const contract = await this.contractRecord(id, version);
    const staff = await this.seeded('STAFF');
    for (const invoice of await this.invoices.panelOptions(id)) {
      const due = dueOf(invoice);
      if (due > 0n)
        await this.payments.recordCounter(
          invoice.id,
          {
            method: PaymentMethod.CASH,
            amountVnd: due,
            reference: `DEMO-PANEL-${runId}-${invoice.number}`,
          },
          staff.caller,
          now,
        );
    }
    await this.returns.close(id, version, staff.caller);
    const after = await this.contractRecord(id);
    return {
      actedAs: staff.actedAs,
      records: this.contractLinks(contract, 'Contract, closed'),
      context: { contractId: id, version: after.version },
    };
  }

  private async contractCancel(id: string, version: number, now: Date): Promise<PanelOutcome> {
    const staff = await this.seeded('STAFF');
    const contract = await this.contractRecord(id, version);
    await this.decisions.cancel(
      id,
      { reason: NOTES.cancel, expectedVersion: version },
      staff.caller,
      now,
    );
    return {
      actedAs: staff.actedAs,
      records: this.contractLinks(contract, 'Request cancelled'),
      context: { contractId: id },
    };
  }

  // --- billing -----------------------------------------------------------------------------------------

  private async invoicePay(id: string, now: Date, runId: number): Promise<PanelOutcome> {
    const invoice = (await this.invoices.panelOptions()).find((row) => row.id === id);
    if (!invoice || dueOf(invoice) === 0n)
      throw conflict(ErrorCode.INVALID_STATE_TRANSITION, 'This invoice has nothing due.');
    const staff = await this.seeded('STAFF');
    await this.payments.recordCounter(
      id,
      { method: PaymentMethod.CASH, amountVnd: dueOf(invoice), reference: `DEMO-PANEL-${runId}` },
      staff.caller,
      now,
    );
    return {
      actedAs: staff.actedAs,
      records: [{ label: 'Invoice paid at the counter', code: invoice.number, path: '/t/billing' }],
    };
  }

  // --- devices -----------------------------------------------------------------------------------------

  private async maintenanceOpen(
    deviceId: string,
    version: number,
    now: Date,
  ): Promise<PanelOutcome> {
    const staff = await this.seeded('STAFF');
    const expectedAt = new Date(businessDay(now).getTime() + 3 * DAY_MS).toISOString().slice(0, 10);
    const { device } = await this.events.transaction((tx) =>
      this.maintenance.open(
        deviceId,
        {
          reason: 'STAFF_REPORTED',
          description: NOTES.maintenance,
          expectedAt,
          expectedVersion: version,
        },
        staff.caller.id,
        now,
        tx,
      ),
    );
    return {
      actedAs: staff.actedAs,
      records: [
        { label: 'Device in maintenance', code: device.assetTag, path: `/t/devices/${deviceId}` },
      ],
    };
  }

  private async maintenanceComplete(deviceId: string, now: Date): Promise<PanelOutcome> {
    const record = await this.maintenance.openRecordOf(deviceId);
    if (!record)
      throw conflict(
        ErrorCode.INVALID_STATE_TRANSITION,
        'This device has no open maintenance record.',
      );
    const staff = await this.seeded('STAFF');
    await this.events.transaction((tx) =>
      this.maintenance.complete(
        deviceId,
        record.id,
        {
          status: 'COMPLETED',
          resolution: NOTES.repaired,
          actualCostVnd: DEMO_REPAIR_COST_VND,
          expectedVersion: record.version,
        },
        staff.caller.id,
        now,
        tx,
      ),
    );
    return {
      actedAs: staff.actedAs,
      records: [{ label: 'Maintenance completed', code: deviceId, path: `/t/devices/${deviceId}` }],
    };
  }

  // --- playback-only commands (REQ-PNL-08) ---------------------------------------------------------------

  private async organizationRegister(runId: number): Promise<PanelOutcome> {
    const organization = await this.onboarding.register({
      ...DEMO_REGISTRATION,
      ...quickOrganizationNames(runId),
      // A tax code no seed or quick run uses: 8 and the run counter.
      taxCode: `8${String(runId).padStart(9, '0')}`,
    });
    return {
      actedAs: null,
      records: [
        {
          label: 'Organization, pending',
          code: organization.code,
          path: `/t/organizations/${organization.id}`,
        },
      ],
      context: {
        organizationId: organization.id,
        organizationCode: organization.code,
        version: organization.version,
      },
    };
  }

  private async organizationVerify(
    id: string,
    version: number,
    now: Date,
    runId: number,
  ): Promise<PanelOutcome> {
    const staff = await this.seeded('STAFF');
    const saved = await this.onboarding.verify(
      id,
      {
        method: 'IN_PERSON',
        documentsSeen: ['Business registration', 'Manager ID card'],
        masterContractRef: `MC-DEMO-${runId}`,
        ndaSigned: true,
        softwareLicenceSigned: true,
        expectedVersion: version,
      },
      staff.caller,
      now,
    );
    return {
      actedAs: staff.actedAs,
      records: [
        { label: 'Organization, verified', code: saved.code, path: `/t/organizations/${id}` },
      ],
      context: { organizationId: id, version: saved.version },
    };
  }

  // MF-02 without a gateway: one simulated position per rented unit of the organization with a node number,
  // near the start of the Ta Nang trail, through the node uplink path (REQ-PNL-08).
  private async fieldPositions(
    organizationId: string | undefined,
    now: Date,
  ): Promise<PanelOutcome> {
    const organization =
      organizationId ??
      (await this.organizations.activeDemoOptions()).find((row) => row.code === DEMO_ORGANIZATION)
        ?.id;
    if (!organization)
      throw conflict(ErrorCode.ORGANIZATION_NOT_ACTIVE, 'The demo organization is not Active.');
    const custody = await this.contracts.visibleDevices({ organizationId: organization });
    const units = (await this.devices.projections(custody.map((unit) => unit.deviceId))).filter(
      (device) => device.status === 'RENTED' && device.nodeNum !== null,
    );
    if (!units.length)
      throw conflict(
        ErrorCode.DEMO_SCENARIO_UNAVAILABLE,
        'The organization has no rented unit with a node number.',
      );
    for (const [index, device] of units.entries()) {
      const { topic, body } = nodePositionUplink(
        Number(device.nodeNum),
        now,
        randomInt(1, 2 ** 31),
        {
          lat: TA_NANG.lat + index * 0.0007,
          lon: TA_NANG.lon + index * 0.0005,
        },
      );
      await this.uplinks.ingest(topic, body, now, { simulated: true });
    }
    return {
      actedAs: null,
      records: [
        {
          label: `Simulated positions, ${units.length} units`,
          code: units.map((device) => device.assetTag).join(', '),
          path: '/o/map',
        },
      ],
      context: { organizationId: organization },
    };
  }
}
