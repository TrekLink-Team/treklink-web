import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PaymentMethod, PlanType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { errorCodeFor, mapPrismaError } from '../../common/filters/http-exception.filter';
import { InvoicesService, PaymentsService } from '../billing';
import { DevicesService, LossCaseService } from '../devices';
import { FieldSimulationService, UplinkIngress } from '../gateway-sync';
import { IncidentTimersJob, IncidentsQueryService } from '../incidents';
import { OrganizationOnboardingService, OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ParameterService } from '../platform/parameters/parameter.service';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import {
  ContractsService,
  ContractDecisionsService,
  HandoverService,
  FaultReportsService,
  rolloverTermEnd,
  TermRolloverJob,
} from '../rentals';
import { DemoQuickGuard } from './demo-quick.guard';
import { DemoQuickRepository } from './demo-quick.repository';
import { DemoQuickProfileService } from './demo-quick-profile.service';
import { DEMO_REGISTRATION } from './demo-scenarios';
import { quickSosUplink } from './demo-sos-packet';
import { StagedRecord } from './demo-scenarios.service';

export const QUICK_ACTIONS = [
  'organization',
  'contract',
  'incident',
  'loss',
  'fault',
  'walkers',
  'profile',
  'term-end',
  'next-tier',
] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];
export interface QuickInput {
  organizationId?: string;
  hardwareVariantId?: string;
  quantity?: number;
  target?: 'REQUESTED' | 'APPROVED' | 'ACTIVE' | 'RETURN_DUE';
  deviceId?: string;
  recordId?: string;
  expectedVersion?: number;
  active?: boolean;
}
export interface QuickResult {
  runId: number;
  label: string;
  records: StagedRecord[];
  error: string | null;
  errorCode: string | null;
}
const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
const conflict = (message: string) =>
  new DomainException(HttpStatus.CONFLICT, ErrorCode.DEMO_SCENARIO_UNAVAILABLE, message);
const businessDay = (at: Date) =>
  new Date(`${new Date(at.getTime() + 7 * 3600000).toISOString().slice(0, 10)}T00:00:00Z`);
// A synthetic PNG for a demo note, never a person's signature.
const DEMO_SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

@Injectable()
export class DemoQuickService {
  constructor(
    private readonly guard: DemoQuickGuard,
    private readonly repository: DemoQuickRepository,
    private readonly profile: DemoQuickProfileService,
    private readonly events: TransactionalEvents,
    private readonly parameters: ParameterService,
    private readonly onboarding: OrganizationOnboardingService,
    private readonly organizations: OrganizationsService,
    private readonly contracts: ContractsService,
    private readonly decisions: ContractDecisionsService,
    private readonly handover: HandoverService,
    private readonly rollover: TermRolloverJob,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly devices: DevicesService,
    private readonly uplinks: UplinkIngress,
    private readonly incidents: IncidentsQueryService,
    private readonly timers: IncidentTimersJob,
    private readonly losses: LossCaseService,
    private readonly faults: FaultReportsService,
    private readonly simulation: FieldSimulationService,
  ) {}

  async options(actor: Caller) {
    this.guard.assert(actor);
    const [organizations, variants, custody, profile, incidents, minimumQuantity] =
      await Promise.all([
        this.organizations.activeDemoOptions(),
        this.devices.variants(true),
        this.contracts.visibleDevices({ organizationId: null }),
        this.profile.status(),
        this.incidents.demoOptions(),
        this.parameters.get('rentals.minOrderQuantity'),
      ]);
    const projections = await this.devices.projections(custody.map((unit) => unit.deviceId));
    const units = custody.flatMap((unit) => {
      const device = projections.find((row) => row.id === unit.deviceId);
      return device?.status === 'RENTED'
        ? [
            {
              ...unit,
              assetTag: device.assetTag,
              nodeNum: device.nodeNum === null ? null : Number(device.nodeNum),
            },
          ]
        : [];
    });
    const contracts = (
      await Promise.all(
        [...new Set(units.map((unit) => unit.contractId))].map((id) =>
          this.contracts.demoDetail(id),
        ),
      )
    )
      .filter((row) => row && ['ACTIVE', 'ENDING'].includes(row.status))
      .map((row) => ({ id: row!.id, code: row!.code, version: row!.version }));
    return {
      organizations,
      variants: variants.filter((v) => v.isActive),
      units,
      contracts,
      incidents,
      profile,
      minimumQuantity,
    };
  }

  async run(
    action: string,
    input: QuickInput,
    actor: Caller,
    now = new Date(),
  ): Promise<QuickResult> {
    this.guard.assert(actor);
    if (!QUICK_ACTIONS.includes(action as QuickAction))
      throw invalid('Choose a listed quick action.');
    this.validate(action as QuickAction, input);
    const run = await this.repository.createRun(actor.id, action);
    const result: QuickResult = {
      runId: run.id,
      label: `Demo ${run.id}`,
      records: [],
      error: null,
      errorCode: null,
    };
    const remember = async (records: StagedRecord[]) => {
      result.records.push(...records);
      await this.events.transaction((tx) =>
        this.repository.saveRun(
          run.id,
          result.records.map((r) => ({ ...r })),
          null,
          tx,
        ),
      );
    };
    let failure: DomainException | undefined;
    try {
      switch (action as QuickAction) {
        case 'organization': {
          const organization = await this.onboarding.register({
            ...DEMO_REGISTRATION,
            legalName: `TrekLink Demo ${run.id} Tours`,
            taxCode: `9${String(run.id).padStart(9, '0')}`,
            managerEmail: `demo.${run.id}@example.com`,
            managerFullName: `Demo Manager ${run.id}`,
          });
          await remember([
            {
              label: 'Pending demo organization',
              code: organization.code,
              path: `/t/organizations/${organization.id}`,
            },
          ]);
          break;
        }
        case 'contract':
          await this.contract(input, actor, now, run.id, remember);
          break;
        case 'incident': {
          const unit = await this.rented(input.deviceId!, actor);
          if (unit.device.nodeNum === null)
            throw conflict(
              `${unit.device.assetTag} has no node number. Choose another rented unit.`,
            );
          if ((await this.incidents.openByDevices([unit.device.id])).has(unit.device.id))
            throw conflict(
              `${unit.device.assetTag} already has an open incident. Resolve it or choose another unit.`,
            );
          const margin = await this.parameters.get('gatewaySync.attributionMarginSeconds');
          if (now.getTime() - unit.custody.handedOverAt.getTime() <= margin * 1000)
            throw conflict(
              'The handover is inside the attribution margin. Wait for the margin or choose an older rented unit.',
            );
          const { topic, body } = quickSosUplink(now, randomInt(1, 2 ** 31));
          const packet = JSON.parse(body.toString()) as Record<string, unknown>;
          const sender = `!${Number(unit.device.nodeNum).toString(16).padStart(8, '0')}`;
          packet.from = Number(unit.device.nodeNum);
          packet.sender = sender;
          await this.uplinks.ingest(
            topic.replace(/![0-9a-f]+$/i, sender),
            Buffer.from(JSON.stringify(packet)),
            now,
            { simulated: true },
          );
          const incident = (await this.incidents.openByDevices([unit.device.id])).get(
            unit.device.id,
          );
          if (!incident)
            throw conflict(
              'SOS was ingested but opened no incident. Check the unit custody and attribution margin.',
            );
          await remember([
            {
              label: 'Simulated SOS incident',
              code: incident.code,
              path: `/t/incidents/${incident.id}`,
            },
          ]);
          break;
        }
        case 'loss': {
          const { device } = await this.rented(input.deviceId!, actor);
          const loss = await this.losses.report(
            device.id,
            { description: `${result.label}: rented unit reported missing during the demo.` },
            actor,
            now,
          );
          await remember([
            { label: 'Demo loss case', code: loss.code, path: `/t/loss-cases/${loss.id}` },
          ]);
          break;
        }
        case 'fault': {
          const { device, custody } = await this.rented(input.deviceId!, actor);
          await this.faults.report(
            custody.contractId,
            device.id,
            `${result.label}: casing fault for the demo.`,
            { ...actor, organizationId: custody.organizationId },
          );
          await remember([
            {
              label: 'Demo fault on contract',
              code: custody.contractCode,
              path: `/t/contracts/${custody.contractId}`,
            },
          ]);
          break;
        }
        case 'walkers': {
          const nodes = await this.simulation.refreshWalkers(actor, now);
          if (!nodes.length)
            throw conflict(
              'No rented unit has a node number. Create an Active contract or choose a rented unit first.',
            );
          await remember(
            nodes.map((node) => ({
              label: 'Simulated walker',
              code: node.assetTag ?? node.deviceId,
              path: `/t/devices/${node.deviceId}`,
            })),
          );
          break;
        }
        case 'profile':
          await this.profile.change(input.active!, input.expectedVersion!, actor);
          break;
        case 'term-end':
          await this.termEnd(input.recordId!, input.expectedVersion!, actor, now, remember);
          break;
        case 'next-tier': {
          const incident = await this.timers.advanceDemo(
            input.recordId!,
            input.expectedVersion!,
            actor,
            now,
          );
          await remember([
            {
              label: `Demo time: ${incident.state}`,
              code: incident.code,
              path: `/t/incidents/${incident.id}`,
            },
          ]);
          break;
        }
      }
    } catch (error) {
      const cause = mapPrismaError(error) ?? error;
      failure =
        cause instanceof DomainException
          ? cause
          : new DomainException(
              cause instanceof HttpException ? cause.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
              cause instanceof HttpException ? errorCodeFor(cause) : ErrorCode.INTERNAL_ERROR,
              cause instanceof Error
                ? cause.message
                : 'Demo action failed. Inspect its records before retrying.',
            );
      result.error = failure.message;
      result.errorCode = failure.errorCode;
    }
    await this.events.transaction(async (tx) => {
      await this.repository.saveRun(
        run.id,
        result.records.map((r) => ({ ...r })),
        result.error,
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: null,
        action: `demo.quick.${action}`,
        subjectType: 'DemoScenarioRun',
        subjectId: String(run.id),
        after: { ...result, input: { ...input }, demo: true },
      } satisfies AuditRecordEvent);
    });
    if (failure) {
      throw new DomainException(failure.httpStatus, failure.errorCode, failure.message, {
        runId: result.runId,
        label: result.label,
        records: result.records,
      });
    }
    return result;
  }

  private validate(action: QuickAction, input: QuickInput) {
    if (
      action === 'contract' &&
      (!input.organizationId ||
        !input.hardwareVariantId ||
        input.quantity === undefined ||
        !input.target)
    )
      throw invalid('Choose Organization, Variant, Quantity and Target state.');
    if (['incident', 'loss', 'fault'].includes(action) && !input.deviceId)
      throw invalid('Choose a rented unit.');
    if (['next-tier', 'term-end'].includes(action) && !input.recordId)
      throw invalid('Choose the record to advance.');
    if (
      ['profile', 'next-tier', 'term-end'].includes(action) &&
      input.expectedVersion === undefined
    )
      throw invalid('Reload the record to supply expectedVersion.');
    if (action === 'profile' && typeof input.active !== 'boolean')
      throw invalid('Choose whether the demo escalation profile is active.');
  }

  private async rented(id: string, actor: Caller) {
    const [device] = await this.devices.projections([id]);
    const custody = (
      await this.contracts.visibleDevices({ organizationId: null, deviceIds: [id] })
    )[0];
    if (!device || device.status !== 'RENTED' || !custody)
      throw conflict('Choose a unit that is currently rented and has live custody.');
    this.guard.assert(actor);
    return { device, custody };
  }

  private async contract(
    input: QuickInput,
    actor: Caller,
    now: Date,
    runId: number,
    remember: (records: StagedRecord[]) => Promise<void>,
  ) {
    if (['ACTIVE', 'RETURN_DUE'].includes(input.target!) && input.quantity! < 2)
      throw invalid('Quantity must be at least two for a multi-unit running contract.');
    const margin = await this.parameters.get('gatewaySync.attributionMarginSeconds');
    // Disclosed demo clock: custody predates the margin, so SOS can be demonstrated immediately.
    const at = new Date(now.getTime() - (margin + 60) * 1000);
    const requested = await this.contracts.request(
      {
        organizationId: input.organizationId,
        planType: PlanType.MONTHLY,
        hardwareVariantId: input.hardwareVariantId!,
        quantity: input.quantity!,
        requestedStartDate: businessDay(at),
      } as Parameters<ContractsService['request']>[0],
      { ...actor, organizationId: input.organizationId! },
      at,
    );
    const { contract } = requested;
    await remember([
      {
        label: 'Demo contract',
        code: contract.code,
        path: `/t/contracts/${contract.id}`,
      },
      { label: 'Counter and invoices', code: contract.code, path: `/t/counter/${contract.id}` },
    ]);
    if (input.target === 'REQUESTED') return;
    const approved = await this.decisions.approve(
      contract.id,
      { handoverAt: now, expectedVersion: contract.version },
      actor,
      at,
    );
    const invoice = await this.invoices.firstChargeableInvoice(contract.id);
    if (!invoice) throw conflict('Contract has no chargeable invoice. Inspect its invoice list.');
    const due = invoice.lines.reduce(
      (sum, line) => sum + (line.amountVnd > line.paidVnd ? line.amountVnd - line.paidVnd : 0n),
      0n,
    );
    if (due > 0n)
      await this.payments.recordCounter(
        invoice.id,
        { method: PaymentMethod.CASH, amountVnd: due, reference: `DEMO-${runId}-${contract.code}` },
        actor,
        at,
      );
    if (input.target === 'APPROVED') return;
    // Only the handover needs a signer; the owning service checks live Manager membership.
    const members = await this.organizations.membersOf(input.organizationId!, false, actor);
    const manager = members.find(
      (member) => member.role === 'MANAGER' && member.deactivatedAt === null,
    );
    if (!manager)
      throw conflict(
        'Organization needs a live Manager before the demo handover. Add or reactivate a Manager, then continue from the contract link.',
      );
    const detail = await this.contracts.demoDetail(contract.id);
    if (!detail) throw conflict('Contract detail is unavailable. Reload the contract.');
    const key = await this.organizations.channelKeyState(input.organizationId!);
    for (const unit of detail.devices)
      await this.handover.provision(contract.id, unit.deviceId, key.channelKeyVersion, actor, at);
    const minBattery = await this.parameters.get('devices.handoverMinBatteryPct');
    const handed = await this.handover.complete(
      contract.id,
      {
        signedByUserId: manager.userId,
        identityChecked: `Demo ${runId}: synthetic signature and manual provisioning, no physical handover`,
        signaturePng: DEMO_SIGNATURE,
        acknowledgeLowBattery: false,
        expectedVersion: approved.contract.version,
        deviceChecks: detail.devices.map((unit) => ({
          deviceId: unit.deviceId,
          batteryPct: Math.max(85, minBattery),
          gpsFixOk: true,
        })),
      },
      actor,
      at,
    );
    if (input.target === 'RETURN_DUE')
      await this.termEnd(contract.id, handed.version, actor, now, () => Promise.resolve());
  }

  private async termEnd(
    id: string,
    version: number,
    actor: Caller,
    now: Date,
    remember: (records: StagedRecord[]) => Promise<void>,
  ) {
    const contract = await this.contracts.demoDetail(id);
    if (!contract) throw conflict('Choose an existing Active or Ending contract.');
    if (contract.version !== version)
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'Reload the contract and try again.',
      );
    let nextVersion = version;
    if (contract.status === 'ACTIVE' && contract.planType === PlanType.MONTHLY)
      nextVersion = (await this.decisions.giveNotice(id, version, actor, now)).contract.version;
    else if (!['ACTIVE', 'ENDING'].includes(contract.status))
      throw conflict('Choose an Active or Ending contract.');
    const hour = await this.parameters.get('rentals.termRolloverHourLocal');
    await this.contracts.endOpenTermAt(id, rolloverTermEnd(now, hour), nextVersion);
    await this.rollover.run(now, id);
    await remember([
      { label: 'Demo time: term ended', code: contract.code, path: `/t/counter/${id}` },
    ]);
  }
}
