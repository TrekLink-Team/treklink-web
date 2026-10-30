import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PagedResult, resolvePage, toPagedResult } from '../../common/dto/paging';
import { DevicesService } from '../devices';
import { ListEventsDto } from './dto/gateway-sync-ops.dto';
import { FieldEventRow, SyncQueryRepository } from './sync-query.repository';

// The page bounds api-design 03 declares for listEvents.
export const EVENT_PAGE_BOUNDS = { defaultPageSize: 100, maxPageSize: 500 };

export type FieldEventView = Omit<FieldEventRow, 'seq'> & { seq: number; assetTag: string | null };

// The two kinds of event a device history carries (monitoring api-design 03).
export const HISTORY_KINDS = ['POSITION', 'TELEMETRY'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

// One point of a device history.
export interface HistoryPoint {
  at: Date;
  kind: HistoryKind;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  batteryPct: number | null;
}

// `op listEvents` (api-design 03, task 4.1): the append-only ledger in ingestion order, oldest first by
// default; `order: "desc"` gives the latest first. TrekLink Staff and Admin only (`read FieldEvent`).
@Injectable()
export class FieldEventQueryService {
  constructor(
    private readonly repository: SyncQueryRepository,
    private readonly devices: DevicesService,
  ) {}

  async listEvents(dto: ListEventsDto): Promise<PagedResult<FieldEventView>> {
    const page = resolvePage(dto, EVENT_PAGE_BOUNDS);
    const where: Prisma.FieldEventWhereInput = {
      ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
      ...(dto.organizationId ? { organizationId: dto.organizationId } : {}),
      ...(dto.kind?.length ? { kind: { in: dto.kind } } : {}),
      ...(dto.incidentId ? { incidentId: dto.incidentId } : {}),
      ...(dto.from || dto.to
        ? {
            receivedAt: {
              ...(dto.from ? { gte: dto.from } : {}),
              ...(dto.to ? { lte: dto.to } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.repository.pageEvents(
      where,
      dto.order ?? 'asc',
      page.skip,
      page.take,
    );
    const tags = await this.devices.assetTags([...new Set(rows.map((row) => row.deviceId))]);
    const items = rows.map((row) => ({
      ...row,
      seq: Number(row.seq),
      assetTag: tags.get(row.deviceId) ?? null,
    }));
    return toPagedResult(items, total, page);
  }

  // --- monitoring reads, `historyPoints(query)` -----------------------------------------------------
  // The positions and telemetry of one device whose occurrence time lies in [from, to), oldest first
  // (monitoring api-design 03, UC-40). An organization sees the events attributed to it, which the
  // ingestion already limited to its custody intervals (FR-EVT-16, BR-36); a null organization is the
  // whole history, `UNATTRIBUTED` included, for TrekLink Staff and Admin. A position marked not plotted
  // (an implausible fix) is never returned (FR-MON-04).
  async historyPoints(query: {
    deviceId: string;
    organizationId: string | null;
    from: Date;
    to: Date;
    kinds: readonly HistoryKind[];
  }): Promise<HistoryPoint[]> {
    const rows = await this.repository.historyRows({
      deviceId: query.deviceId,
      ...(query.organizationId === null ? {} : { organizationId: query.organizationId }),
      kind: { in: [...query.kinds] },
      occurredAt: { gte: query.from, lt: query.to },
      NOT: { kind: 'POSITION', plotted: false },
    });
    return rows.map((row) => ({
      at: row.occurredAt,
      kind: row.kind as HistoryKind,
      lat: row.latitude,
      lon: row.longitude,
      altitude: row.altitude,
      batteryPct: row.batteryPct,
    }));
  }
  // --- end monitoring reads ---------------------------------------------------------------------------
}
