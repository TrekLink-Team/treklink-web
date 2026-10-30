import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PagedResult, resolvePage, toPagedResult } from '../../common/dto/paging';
import { DevicesService } from '../devices';
import { ListEventsDto } from './dto/gateway-sync-ops.dto';
import { FieldEventRow, SyncQueryRepository } from './sync-query.repository';

// The page bounds api-design 03 declares for listEvents.
export const EVENT_PAGE_BOUNDS = { defaultPageSize: 100, maxPageSize: 500 };

export type FieldEventView = Omit<FieldEventRow, 'seq'> & { seq: number; assetTag: string | null };

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
}
