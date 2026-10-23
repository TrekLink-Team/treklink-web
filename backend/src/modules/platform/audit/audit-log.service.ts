import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../../common/dto/paging';
import { DomainException, ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../config/environment-variables';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../ports/account-directory.port';
import { ActorRef, resolveActors } from '../ports/actor-names';
import { AuditLogQueryDto } from './audit-log-query.dto';
import { AuditLogRepository, AuditLogRow } from './audit-log.repository';

export type AuditLogItem = Omit<AuditLogRow, 'actorId'> & { actor: ActorRef | null };

// Searches the generic audit log, newest first (task 3.1, UC-58, api-design 05). `actor` is null for a
// SYSTEM action.
@Injectable()
export class AuditLogService {
  constructor(
    private readonly auditLog: AuditLogRepository,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  async search(query: AuditLogQueryDto): Promise<PagedResult<AuditLogItem>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.auditLog.page(this.whereOf(query), page.skip, page.take);
    const actorOf = await resolveActors(
      this.directory,
      rows.map((row) => row.actorId),
    );
    const items = rows.map(({ actorId, ...row }) => ({ ...row, actor: actorOf(actorId) }));
    return toPagedResult(items, total, page);
  }

  private whereOf(query: AuditLogQueryDto): Prisma.AuditLogWhereInput {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'from must be earlier than to.',
      );
    }
    return {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    };
  }
}
