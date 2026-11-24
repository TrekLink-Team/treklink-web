import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { AuditLogService } from '../platform/audit/audit-log.service';
import {
  databaseNameOf,
  demoDatabaseMatches,
  isDemoDatabaseUrls,
} from '../platform/config/database-url';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  PANEL_AUDIT_ROLE,
  PANEL_RESET_CONFIRMATION,
  PANEL_RESET_SPACING_MS,
} from './demo-panel.constants';
import { DemoPanelLock } from './demo-panel-lock';
import { DemoPanelPlayback } from './demo-panel-playback';
import { DemoResetRepository } from './demo-reset.repository';
import { DemoSeedPasswords, DemoSeedRunner } from './demo-seed.runner';

export const PANEL_RESET_ACTION = 'demo.panel.reset';

export interface ResetAvailability {
  available: boolean;
  reason: string | null;
  nextAllowedAt: Date | null;
}

export interface ResetResult {
  resetAt: Date;
  tables: number;
  seedGroups: number;
}

const forbidden = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.FORBIDDEN, code, message);
const busy = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.DEMO_BUSY,
    'A demo action is already running. Try again in a moment.',
  );

const OFF = 'The demo reseed is off on this deployment.';
const WRONG_DATABASE = 'The reseed runs only on the dedicated demo database.';
const NO_SEED = 'The demo seed is not in this build.';

// The reseed of the demo panel (specs/demo/requirements.md REQ-PNL-09, REQ-PNL-12, design §11, D-110
// rule 4). Checked in order before any row is touched: DEMO_RESET_ENABLED, the live database is exactly
// the DEMO_DATABASE_HOST branch, the typed confirmation, five minutes since the last reseed (in process
// and in the audit log, so a restart does not reopen it), no reseed or playback running, the seed passwords
// and the seed file. Then a data-only wipe, the standard demo seed, and the audit entry written after the
// wipe so it is kept. It never runs a migration or a schema statement.
@Injectable()
export class DemoPanelResetService {
  private readonly logger = new Logger(DemoPanelResetService.name);
  private lastStartedAt: number | null = null;

  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    private readonly events: TransactionalEvents,
    private readonly parameters: ParameterService,
    private readonly auditLog: AuditLogService,
    private readonly repository: DemoResetRepository,
    private readonly seed: DemoSeedRunner,
    private readonly playback: DemoPanelPlayback,
    private readonly lock: DemoPanelLock,
  ) {}

  // Every check that needs no input, for the panel's reseed card (api-design 13 `reset`).
  async availability(now = new Date()): Promise<ResetAvailability> {
    try {
      this.assertEnvironment();
      await this.assertSpacing(now);
      this.assertIdle();
      this.seedPasswords();
      return { available: true, reason: null, nextAllowedAt: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The reseed is not available.';
      return { available: false, reason: message, nextAllowedAt: await this.nextAllowedAt(now) };
    }
  }

  async reset(confirmation: string, client: string, now = new Date()): Promise<ResetResult> {
    this.assertEnvironment();
    if (confirmation !== PANEL_RESET_CONFIRMATION)
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        `Type ${PANEL_RESET_CONFIRMATION} to confirm.`,
      );
    await this.assertSpacing(now);
    this.assertIdle();
    const passwords = this.seedPasswords();

    this.lock.beginReset();
    this.lastStartedAt = now.getTime();
    let tables: number | null = null;
    let seedGroups: number | null = null;
    let failure: unknown = null;
    try {
      this.logger.log(`Demo panel reset started from ${client}.`);
      // Read before the wipe: the parameter tables are kept, and the seed is dated a margin and a minute
      // earlier so a reading or an SOS right after the reseed is attributed (design §4).
      const margin = await this.parameters.get('gatewaySync.attributionMarginSeconds');
      await this.assertLiveDatabase();
      tables = (await this.repository.wipeData()).length;
      seedGroups = (await this.seed.run(passwords, new Date(now.getTime() - (margin + 60) * 1000)))
        .length;
      this.logger.log(`Demo panel reset finished: ${tables} tables, ${seedGroups} seed groups.`);
      return { resetAt: now, tables, seedGroups };
    } catch (error) {
      failure = error;
      this.logger.error(`Demo panel reset failed after ${tables ?? 0} tables were wiped.`);
      throw error;
    } finally {
      // Written on success and on failure, after the wipe, so it is kept and also starts the
      // five-minute spacing for a failed reseed (review of treklink-web#541).
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: null,
        actorRoles: [PANEL_AUDIT_ROLE],
        organizationId: null,
        action: PANEL_RESET_ACTION,
        subjectType: 'Database',
        subjectId: null,
        after: {
          tables,
          seedGroups,
          error: failure ? (failure instanceof Error ? failure.message : 'Unknown failure') : null,
          demo: true,
        },
        ip: client,
      } satisfies AuditRecordEvent);
      this.lock.endReset();
    }
  }

  private assertIdle() {
    if (this.lock.resetting || this.lock.actionsInFlight > 0 || this.playback.active())
      throw busy();
  }

  // The connection Prisma actually uses (review of treklink-web#541): the client reads DATABASE_URL from
  // the process environment when it is built, so that value must name the demo branch too, and the live
  // connection must be on the database that URL names.
  private async assertLiveDatabase() {
    const processUrl = process.env.DATABASE_URL;
    const direct = this.config.get('DATABASE_DIRECT_URL', { infer: true });
    const host = this.config.get('DEMO_DATABASE_HOST', { infer: true });
    if (processUrl !== undefined && !isDemoDatabaseUrls(host, processUrl, direct))
      throw forbidden(ErrorCode.DEMO_DATABASE_NOT_ALLOWED, WRONG_DATABASE);
    const expected = databaseNameOf(processUrl ?? this.config.get('DATABASE_URL', { infer: true }));
    if (expected === null || (await this.repository.currentDatabase()) !== expected)
      throw forbidden(ErrorCode.DEMO_DATABASE_NOT_ALLOWED, WRONG_DATABASE);
  }

  private assertEnvironment() {
    if (this.config.get('DEMO_RESET_ENABLED', { infer: true }) !== true)
      throw forbidden(ErrorCode.DEMO_DISABLED, OFF);
    if (!demoDatabaseMatches(this.config))
      throw forbidden(ErrorCode.DEMO_DATABASE_NOT_ALLOWED, WRONG_DATABASE);
  }

  private async lastResetAt(): Promise<number | null> {
    const audited = (await this.auditLog.latestOf(PANEL_RESET_ACTION))?.getTime() ?? null;
    const times = [audited, this.lastStartedAt].filter((t): t is number => t !== null);
    return times.length ? Math.max(...times) : null;
  }

  private async nextAllowedAt(now: Date): Promise<Date | null> {
    const last = await this.lastResetAt();
    return last !== null && now.getTime() - last < PANEL_RESET_SPACING_MS
      ? new Date(last + PANEL_RESET_SPACING_MS)
      : null;
  }

  private async assertSpacing(now: Date) {
    const next = await this.nextAllowedAt(now);
    if (next)
      throw new DomainException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        `A reseed ran less than 5 minutes ago. Try again after ${this.clock(next)}.`,
      );
  }

  private seedPasswords(): DemoSeedPasswords {
    if (!this.seed.loadable())
      throw new DomainException(HttpStatus.CONFLICT, ErrorCode.DEMO_SEED_NOT_CONFIGURED, NO_SEED);
    return this.seed.passwords();
  }

  private clock(at: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: this.config.get('DISPLAY_TIMEZONE_DEFAULT', { infer: true }),
    }).format(at);
  }
}
