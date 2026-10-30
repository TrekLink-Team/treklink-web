import { Injectable } from '@nestjs/common';
import { MemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

// The live member of a shift slot: the account id, or null when the slot is empty or its member is
// deactivated.
export interface ShiftSlots {
  primaryUserId: string | null;
  backupUserId: string | null;
}

const LIVE_USER = { select: { userId: true, deactivatedAt: true } } as const;
const liveUser = (member: { userId: string; deactivatedAt: Date | null } | null): string | null =>
  member && member.deactivatedAt === null ? member.userId : null;

// Roster reads over `roster_shifts` (task 2.6). Shift administration is TanNB's part of 2.6; this
// file holds only what incidents routing needs.
@Injectable()
export class RosterRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The shift covering the instant, `[startsAt, endsAt)`. The exclusion constraint allows at most one.
  async slotsAt(
    organizationId: string,
    at: Date,
    client: Client = this.prisma,
  ): Promise<ShiftSlots> {
    const shift = await client.rosterShift.findFirst({
      where: { organizationId, startsAt: { lte: at }, endsAt: { gt: at } },
      select: { primaryMember: LIVE_USER, backupMember: LIVE_USER },
    });
    return {
      primaryUserId: liveUser(shift?.primaryMember ?? null),
      backupUserId: liveUser(shift?.backupMember ?? null),
    };
  }

  // A deactivated member leaves every shift that has not ended, a shift in progress included
  // (REQ-EVT-08, D-034): the slot becomes empty, so alerting in that window starts at the next tier.
  // Returns how many slots were cleared.
  async clearMember(memberId: string, from: Date, client: Client): Promise<number> {
    const primary = await client.rosterShift.updateMany({
      where: { primaryMemberId: memberId, endsAt: { gt: from } },
      data: { primaryMemberId: null },
    });
    const backup = await client.rosterShift.updateMany({
      where: { backupMemberId: memberId, endsAt: { gt: from } },
      data: { backupMemberId: null },
    });
    return primary.count + backup.count;
  }

  // Account ids of the organization's live Managers.
  async managerUserIds(organizationId: string, client: Client = this.prisma): Promise<string[]> {
    const rows = await client.organizationMember.findMany({
      where: { organizationId, role: MemberRole.MANAGER, deactivatedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }
}
