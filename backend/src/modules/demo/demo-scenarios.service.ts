import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InvoiceLineType, PaymentMethod, PlanType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { DemoSessionService, type ClientInfo, type SessionUser, type SignInResult } from '../auth';
import { InvoicesService, PaymentsService } from '../billing';
import { DevicesService, MaintenanceService } from '../devices';
import { UplinkIngress } from '../gateway-sync';
import { IncidentsQueryService } from '../incidents';
import { OrganizationOnboardingService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  ContractDecisionsService,
  ContractsService,
  rolloverTermEnd,
  TermRolloverJob,
} from '../rentals';
import { tomorrowBusinessDay } from './demo-clock';
import { DemoGuardService, DemoFacts } from './demo-guard.service';
import { DemoResetRepository } from './demo-reset.repository';
import { BACKEND_ROOT, DemoSeedRunner } from './demo-seed.runner';
import {
  DEMO_REGISTRATION,
  Scenario,
  ScenarioId,
  SCENARIOS,
  scenarioOf,
  SEEDED_EMAILS,
  SeededRole,
} from './demo-scenarios';

export interface StagedRecord {
  label: string;
  code: string;
  path: string;
}

export interface StageResult {
  scenarioId: ScenarioId;
  stagedAt: Date;
  records: StagedRecord[];
  firstSteps: string[];
  session: SignInResult;
}

export interface DemoStatus extends DemoFacts {
  lastStaged: { scenarioId: ScenarioId; at: Date } | null;
}

export type ScenarioView = Omit<Scenario, 'firstSteps'>;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const BUSINESS_ZONE_OFFSET_MS = 7 * 60 * MINUTE_MS;

// The calendar day of `at` in UTC+7 as a UTC-midnight date, the shape of a @db.Date column.
const businessDay = (at: Date): Date => {
  const local = new Date(at.getTime() + BUSINESS_ZONE_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
};

const dayString = (day: Date): string => day.toISOString().slice(0, 10);

const callerOf = (user: SessionUser): Caller => ({
  id: user.id,
  roles: user.roles,
  organizationId: user.organization?.id ?? null,
});

const SOS_FIXTURE = join(BACKEND_ROOT, 'test', 'fixtures', 'mqtt', 'sos.json');

interface FixtureMessage {
  topic: string;
  message: Record<string, unknown>;
}

// The `sos` fixture as `replay:mqtt -- sos --now --new-ids` publishes it: a fresh packet id and the
// device time now (backend/test/harness/replay.ts `prepare`).
export const sosUplink = (now: Date, packetId: number, file = SOS_FIXTURE) => {
  const [fixture] = (JSON.parse(readFileSync(file, 'utf8')) as { messages: FixtureMessage[] })
    .messages;
  const message = { ...fixture.message, id: packetId, timestamp: Math.floor(now.getTime() / 1000) };
  return { topic: fixture.topic, body: Buffer.from(JSON.stringify(message)) };
};

// Staging of specs/demo/design.md §5. Every step after the seed goes through another module's
// exported service, acting as the seeded account whose screen the step stands for.
@Injectable()
export class DemoScenariosService {
  private readonly logger = new Logger(DemoScenariosService.name);
  private lastStaged: DemoStatus['lastStaged'] = null;

  constructor(
    private readonly guard: DemoGuardService,
    private readonly reset: DemoResetRepository,
    private readonly seed: DemoSeedRunner,
    private readonly sessions: DemoSessionService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly onboarding: OrganizationOnboardingService,
    private readonly contracts: ContractsService,
    private readonly decisions: ContractDecisionsService,
    private readonly termRollover: TermRolloverJob,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly devices: DevicesService,
    private readonly maintenance: MaintenanceService,
    private readonly uplinks: UplinkIngress,
    private readonly incidents: IncidentsQueryService,
  ) {}

  status(): DemoStatus {
    return { ...this.guard.facts(), lastStaged: this.lastStaged };
  }

  list(): ScenarioView[] {
    return SCENARIOS.map(({ firstSteps: _steps, ...view }) => view);
  }

  switchRole(role: SeededRole, client: ClientInfo): Promise<SignInResult> {
    return this.guard.run(() => this.sessions.switchTo(SEEDED_EMAILS[role], client));
  }

  stage(id: string, client: ClientInfo, now: Date = new Date()): Promise<StageResult> {
    return this.guard.run(async () => {
      const scenario = scenarioOf(id);
      if (!scenario) {
        throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Scenario not found.');
      }
      if (!scenario.available) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.DEMO_SCENARIO_UNAVAILABLE,
          scenario.unavailableReason ?? 'This scenario is not available.',
        );
      }
      const passwords = this.seed.passwords();

      // Read before the reset: the parameter tables are kept, and the seed is dated a margin and a
      // minute earlier so an SOS or reading sent right after the stage is attributed (design §4).
      const margin = await this.parameters.get('gatewaySync.attributionMarginSeconds');
      const reset = await this.reset.reset();
      const created = await this.seed.run(
        passwords,
        new Date(now.getTime() - (margin + 60) * 1000),
      );
      this.logger.log(
        `Demo ${scenario.id}: ${reset.truncated.length} tables truncated, ${created.length} seed row groups.`,
      );

      const records = await this.apply(scenario.id, now);
      const session = await this.sessions.switchTo(SEEDED_EMAILS.ADMIN, client);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: session.user.id,
        actorRoles: session.user.roles,
        organizationId: null,
        action: 'demo.stage',
        subjectType: 'DemoScenario',
        subjectId: scenario.id,
        after: { records },
      } satisfies AuditRecordEvent);
      this.lastStaged = { scenarioId: scenario.id, at: now };
      return {
        scenarioId: scenario.id,
        stagedAt: now,
        records,
        firstSteps: scenario.firstSteps,
        session,
      };
    });
  }

  private async apply(id: ScenarioId, now: Date): Promise<StagedRecord[]> {
    switch (id) {
      case 'clean':
        return this.contractRecords(['RC-2026-0001', 'RC-2026-0002', 'RC-2026-0003']);
      case 'org-pending-approval':
        return this.orgPendingApproval();
      case 'contract-ready-for-handover':
        return this.contractReadyForHandover(now);
      case 'sos-open':
        return this.sosOpen(now);
      case 'term-ended':
        return this.termEnded(now);
      case 'asset-maintenance':
        return this.assetMaintenance(now);
      default:
        return [];
    }
  }

  private async account(role: SeededRole): Promise<SessionUser> {
    const user = await this.sessions.accountOf(SEEDED_EMAILS[role]);
    if (!user) throw new Error(`The demo seed did not create ${SEEDED_EMAILS[role]}.`);
    return user;
  }

  private async contractByCode(code: string) {
    const contract = await this.contracts.byCode(code);
    if (!contract) throw new Error(`The demo seed did not create ${code}.`);
    return contract;
  }

  private async contractRecords(codes: string[]): Promise<StagedRecord[]> {
    const records: StagedRecord[] = [];
    for (const code of codes) {
      const contract = await this.contractByCode(code);
      records.push({ label: 'Contract', code, path: `/t/contracts/${contract.id}` });
    }
    return records;
  }

  private async orgPendingApproval(): Promise<StagedRecord[]> {
    const organization = await this.onboarding.register(DEMO_REGISTRATION);
    return [{ label: 'Organization, pending', code: organization.code, path: '/t/organizations' }];
  }

  private async contractReadyForHandover(now: Date): Promise<StagedRecord[]> {
    const [manager, staff] = [await this.account('ORG_MANAGER'), await this.account('STAFF')];
    const variant = (await this.devices.variants()).find((v) => v.code === 'treklink-v3');
    if (!variant) throw new Error('The demo seed did not create treklink-v3.');

    const { contract } = await this.contracts.request(
      {
        planType: PlanType.MONTHLY,
        hardwareVariantId: variant.id,
        quantity: 5,
        requestedStartDate: businessDay(now),
      },
      callerOf(manager),
      now,
    );
    // The next whole minute: an appointment before the current minute is refused (REQ-ERR-09).
    const handoverAt = new Date((Math.floor(now.getTime() / MINUTE_MS) + 1) * MINUTE_MS);
    await this.decisions.approve(
      contract.id,
      { handoverAt, expectedVersion: contract.version },
      callerOf(staff),
      now,
    );

    const invoice = await this.invoices.firstChargeableInvoice(contract.id);
    const holding = invoice?.lines.find((line) => line.type === InvoiceLineType.HOLDING_FEE);
    if (!invoice || !holding) throw new Error(`${contract.code} has no holding-fee line.`);
    await this.payments.recordCounter(
      invoice.id,
      {
        method: PaymentMethod.CASH,
        amountVnd: holding.amountVnd - holding.paidVnd,
        reference: `DEMO-${contract.code}-HOLD`,
      },
      callerOf(staff),
      now,
    );
    return [
      { label: 'Contract, approved', code: contract.code, path: `/t/contracts/${contract.id}` },
      { label: 'Counter handover', code: contract.code, path: `/t/counter/${contract.id}` },
    ];
  }

  private async sosOpen(now: Date): Promise<StagedRecord[]> {
    const { topic, body } = sosUplink(now, randomInt(1, 2 ** 31));
    await this.uplinks.ingest(topic, body, now);
    const device = await this.devices.byAssetTag('TL-0010');
    const incident = device
      ? (await this.incidents.openByDevices([device.id])).get(device.id)
      : undefined;
    if (!incident) throw new Error('The TL-0010 SOS opened no incident.');
    return [
      { label: 'Incident, TL-0010', code: incident.code, path: `/o/incidents/${incident.id}` },
    ];
  }

  private async termEnded(now: Date): Promise<StagedRecord[]> {
    const manager = await this.account('ORG_MANAGER');
    const contract = await this.contractByCode('RC-2026-0002');
    await this.decisions.giveNotice(contract.id, contract.version, callerOf(manager), now);
    const hour = await this.parameters.get('rentals.termRolloverHourLocal');
    await this.contracts.endOpenTermAt(contract.id, rolloverTermEnd(now, hour));
    const outcome = await this.termRollover.run(now);
    if (outcome.returnDue < 1)
      throw new Error('The term rollover moved no contract to RETURN_DUE.');
    return [
      { label: 'Contract, return due', code: contract.code, path: `/t/contracts/${contract.id}` },
      { label: 'Counter check-in', code: contract.code, path: `/t/counter/${contract.id}` },
    ];
  }

  private async assetMaintenance(now: Date): Promise<StagedRecord[]> {
    const staff = await this.account('STAFF');
    const [inMaintenance, serviceDue] = [
      await this.devices.byAssetTag('TL-0007'),
      await this.devices.byAssetTag('TL-0002'),
    ];
    if (!inMaintenance || !serviceDue)
      throw new Error('The demo seed did not create TL-0007 and TL-0002.');
    await this.events.transaction((tx) =>
      this.maintenance.open(
        inMaintenance.id,
        {
          reason: 'STAFF_REPORTED',
          description: 'Casing seal worn; reseal before the next rental.',
          expectedAt: dayString(new Date(businessDay(now).getTime() + 3 * DAY_MS)),
          expectedVersion: inMaintenance.version,
        },
        staff.id,
        now,
        tx,
      ),
    );
    await this.devices.scheduleService(serviceDue.id, tomorrowBusinessDay(now));
    return [
      { label: 'Device in maintenance', code: 'TL-0007', path: `/t/devices/${inMaintenance.id}` },
      { label: 'Device due for service', code: 'TL-0002', path: `/t/devices/${serviceDue.id}` },
      { label: 'Maintenance records', code: 'TL-0007', path: '/t/maintenance' },
    ];
  }
}
