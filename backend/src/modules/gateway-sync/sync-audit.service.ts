import { Injectable } from '@nestjs/common';
import { IngressPath, Prisma, SyncOutcome } from '@prisma/client';
import { PagedResult, resolvePage, toPagedResult } from '../../common/dto/paging';
import { DevicesService } from '../devices';
import { ListAuditDto } from './dto/gateway-sync-ops.dto';
import { SyncAuditRow, SyncQueryRepository } from './sync-query.repository';

// The page bounds api-design 04 declares for listAudit.
export const AUDIT_PAGE_BOUNDS = { defaultPageSize: 100, maxPageSize: 500 };

// The longest excerpt of a malformed message's raw payload that listAudit answers (api-design 04).
// A wire bound of the read, like the page bounds, so a broken publish cannot fill a page.
export const RAW_EXCERPT_MAX_CHARS = 500;

export interface SyncAuditView {
  id: string;
  eventId: string | null;
  nodeNum: number | null;
  deviceId: string | null;
  assetTag: string | null;
  uplinkKey: string | null;
  ingress: IngressPath;
  outcome: SyncOutcome;
  detail: string | null;
  // Only for MALFORMED_ENVELOPE, whose raw payload is the only record of what arrived (REQ-ERR-01);
  // null for every other outcome.
  rawExcerpt: string | null;
  rawTruncated: boolean;
  createdAt: Date;
}

// A payload that was not JSON is stored as its text; anything else as JSON, shown serialized.
const rawText = (raw: Prisma.JsonValue | null): string | null => {
  if (raw === null || raw === undefined) return null;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
};

export const excerptOf = (
  row: Pick<SyncAuditRow, 'outcome' | 'rawMessage'>,
): Pick<SyncAuditView, 'rawExcerpt' | 'rawTruncated'> => {
  const text = row.outcome === SyncOutcome.MALFORMED_ENVELOPE ? rawText(row.rawMessage) : null;
  if (text === null) return { rawExcerpt: null, rawTruncated: false };
  const truncated = text.length > RAW_EXCERPT_MAX_CHARS;
  return {
    rawExcerpt: truncated ? text.slice(0, RAW_EXCERPT_MAX_CHARS) : text,
    rawTruncated: truncated,
  };
};

// `op listAudit` (api-design 04, task 4.1): the append-only sync audit, one row per ingestion attempt
// with its outcome (REQ-UBI-02), newest first. TrekLink Staff and Admin (`read FieldEvent`).
@Injectable()
export class SyncAuditService {
  constructor(
    private readonly repository: SyncQueryRepository,
    private readonly devices: DevicesService,
  ) {}

  async listAudit(dto: ListAuditDto): Promise<PagedResult<SyncAuditView>> {
    const page = resolvePage(dto, AUDIT_PAGE_BOUNDS);
    const where: Prisma.SyncAuditLogWhereInput = {
      ...(dto.outcome?.length ? { outcome: { in: dto.outcome } } : {}),
      ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
      ...(dto.uplinkKey ? { uplinkKey: dto.uplinkKey } : {}),
      ...(dto.from || dto.to
        ? {
            createdAt: {
              ...(dto.from ? { gte: dto.from } : {}),
              ...(dto.to ? { lte: dto.to } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.repository.pageAudit(where, page.skip, page.take);
    const deviceIds = [
      ...new Set(rows.map((row) => row.deviceId).filter((id): id is string => id !== null)),
    ];
    const tags = await this.devices.assetTags(deviceIds);
    const items = rows.map(({ rawMessage, nodeNum, ...row }): SyncAuditView => ({
      ...row,
      nodeNum: nodeNum === null ? null : Number(nodeNum),
      assetTag: row.deviceId ? (tags.get(row.deviceId) ?? null) : null,
      ...excerptOf({ outcome: row.outcome, rawMessage }),
    }));
    return toPagedResult(items, total, page);
  }
}
