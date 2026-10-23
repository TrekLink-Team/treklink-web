import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { currentRequestId } from '../../../common/context/request-context';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AUDIT_RECORD, AuditRecordEvent } from './audit-record.event';
import { redact } from './redact';

// A snapshot as JSON the column accepts: redacted first, then dates and decimals as strings.
const toSnapshot = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined || value === null
    ? undefined
    : (JSON.parse(JSON.stringify(redact(value))) as Prisma.InputJsonValue);

// Persists `audit.record` into `audit_log` (specs/platform/design.md §4.5, REQ-EVT-02, UC-58). The
// event arrives after the business transaction committed, so a failed insert is logged with the
// whole redacted entry and never fails that operation (REQ-ERR-06).
@Injectable()
export class AuditSinkListener {
  private readonly logger = new Logger(AuditSinkListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(AUDIT_RECORD)
  async record(event: AuditRecordEvent): Promise<void> {
    const requestId = event.requestId ?? currentRequestId() ?? null;
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: event.actorId,
          actorRoles: event.actorRoles,
          organizationId: event.organizationId,
          action: event.action,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          before: toSnapshot(event.before),
          after: toSnapshot(event.after),
          requestId,
          ip: event.ip ?? null,
        },
      });
    } catch (error) {
      const entry = {
        ...event,
        requestId,
        before: redact(event.before),
        after: redact(event.after),
      };
      this.logger.error(
        `Audit entry not persisted: ${error instanceof Error ? error.message : String(error)}; ` +
          `entry ${JSON.stringify(entry, (_name, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          )}`,
      );
    }
  }
}
