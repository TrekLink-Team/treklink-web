import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { PagedResult, pagingBoundsFrom, resolvePage, toPagedResult } from '../../common/dto/paging';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../platform/ports/account-directory.port';
import { resolveActors } from '../platform/ports/actor-names';
import { RunStockTakeDto, StockTakeQueryDto } from './dto/stock-take.dto';
import { StockTakeResult, classify } from './stock-take-classify';
import { StockTakeRow, StockTakesRepository } from './stock-takes.repository';

export { classify, type StockTakeResult, type UnconfirmedUnit } from './stock-take-classify';

const HOUR_MS = 60 * 60 * 1000;

export interface StockTakeRun extends StockTakeResult {
  id: string;
  createdAt: Date;
}

export interface StockTakeSummary {
  id: string;
  takenBy: string | null;
  createdAt: Date;
  scannedCount: number;
  unconfirmedCount: number;
  unknownCount: number;
}

const countOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const summaryCounts = (row: StockTakeRow) => {
  const result = (row.result ?? {}) as Record<string, unknown>;
  return {
    scannedCount:
      typeof result.scannedCount === 'number' ? result.scannedCount : row.scannedTags.length,
    unconfirmedCount: countOf(result.unconfirmed),
    unknownCount: countOf(result.unknownTags),
  };
};

// Stock-take (devices task 2.6, api-design 25 and 26, UC-54, FR-DEV-10). One request is one count;
// screen 4.5 keeps the scan list until Finish.
@Injectable()
export class StockTakeService {
  constructor(
    private readonly stockTakes: StockTakesRepository,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  async run(dto: RunStockTakeDto, caller: Caller, at: Date = new Date()): Promise<StockTakeRun> {
    const scannedTags = [...new Set(dto.scannedTags)];
    return this.events.transaction(async (tx) => {
      const hours = await this.parameters.get('devices.stockTakeSeenHours', tx);
      const devices = await this.stockTakes.countedDevices(tx);
      const result = classify(devices, scannedTags, new Date(at.getTime() - hours * HOUR_MS));
      const row = await this.stockTakes.insert(
        {
          scannedTags,
          result: result as unknown as Prisma.InputJsonValue,
          takenById: caller.id,
          createdAt: at,
        },
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: [...caller.roles],
        organizationId: null,
        action: 'stockTake.run',
        subjectType: 'StockTake',
        subjectId: row.id,
        before: null,
        after: {
          scannedCount: result.scannedCount,
          inStockConfirmed: result.inStockConfirmed,
          rentedSeen: result.rentedSeen,
          unconfirmedCount: result.unconfirmed.length,
          unknownCount: result.unknownTags.length,
        },
      } satisfies AuditRecordEvent);
      return { id: row.id, createdAt: row.createdAt, ...result };
    });
  }

  async list(query: StockTakeQueryDto): Promise<PagedResult<StockTakeSummary>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.stockTakes.page(page.skip, page.take);
    const actor = await resolveActors(
      this.directory,
      rows.map((row) => row.takenById),
    );
    return toPagedResult(
      rows.map((row) => ({
        id: row.id,
        takenBy: actor(row.takenById)?.fullName ?? null,
        createdAt: row.createdAt,
        ...summaryCounts(row),
      })),
      total,
      page,
    );
  }
}
