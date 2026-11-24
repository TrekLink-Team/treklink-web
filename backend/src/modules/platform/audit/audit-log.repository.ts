import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

export const AUDIT_LOG_SELECT = {
  id: true,
  actorId: true,
  actorRoles: true,
  organizationId: true,
  action: true,
  subjectType: true,
  subjectId: true,
  before: true,
  after: true,
  requestId: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

export type AuditLogRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_LOG_SELECT }>;

// Reads of the append-only audit log (task 3.1). The sink writes through AuditSinkListener.
@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  page(
    where: Prisma.AuditLogWhereInput,
    skip: number,
    take: number,
  ): Promise<[AuditLogRow[], number]> {
    return Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: AUDIT_LOG_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
  }

  // The time of the newest entry of one action, or null (the demo panel reseed spacing, D-110).
  async latestOf(action: string): Promise<Date | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: { action },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }
}
