import { Injectable } from '@nestjs/common';
import { Prisma, StaleSubject } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface StaleMarkRow {
  subjectType: StaleSubject;
  subjectId: string;
  organizationId: string | null;
  lastSeenAt: Date;
  markedAt: Date;
}

type Client = Prisma.TransactionClient | PrismaService;

// What the staleness sweep last reported stale (task 2.4, design §1). A row exists from the stale entry
// to the recovered entry, so the sweep reports each transition once, across restarts as well.
@Injectable()
export class StaleMarksRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(subjectType: StaleSubject): Promise<StaleMarkRow[]> {
    return this.prisma.staleMark.findMany({ where: { subjectType } });
  }

  // True when this call wrote the mark, false when the subject was already marked. The stale entry is
  // emitted only by the caller that wrote it.
  async mark(row: StaleMarkRow, tx: Client = this.prisma): Promise<boolean> {
    const { count } = await tx.staleMark.createMany({ data: [row], skipDuplicates: true });
    return count === 1;
  }

  // True when this call removed the mark. `organizationId` given: only a mark written for that
  // organization is removed, so a mark replaced in between is left alone.
  async clear(
    subjectType: StaleSubject,
    subjectId: string,
    tx: Client = this.prisma,
    organizationId?: string | null,
  ): Promise<boolean> {
    const { count } = await tx.staleMark.deleteMany({
      where: { subjectType, subjectId, ...(organizationId !== undefined && { organizationId }) },
    });
    return count === 1;
  }
}
