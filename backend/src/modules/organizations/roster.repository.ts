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

  // Shift administration (task 2.6, api-design 16 to 19). Every write runs in the caller's transaction,
  // under the organization row lock the service takes first.

  // The shifts that touch `[from, to)`, earliest first.
  shiftsBetween(
    organizationId: string,
    from: Date,
    to: Date,
    client: Client = this.prisma,
  ): Promise<ShiftRow[]> {
    return client.rosterShift.findMany({
      where: { organizationId, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      select: SHIFT_SELECT,
    });
  }

  // A shift of this organization; null for an unknown id or another organization's.
  findShift(
    organizationId: string,
    shiftId: string,
    client: Client = this.prisma,
  ): Promise<ShiftRow | null> {
    return client.rosterShift.findFirst({
      where: { id: shiftId, organizationId },
      select: SHIFT_SELECT,
    });
  }

  // Whether another shift of the organization overlaps `[startsAt, endsAt)`; two shifts that only touch
  // do not overlap. `exceptShiftId` leaves the shift being edited out.
  async overlaps(
    organizationId: string,
    startsAt: Date,
    endsAt: Date,
    exceptShiftId: string | null,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const found = await client.rosterShift.findFirst({
      where: {
        organizationId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(exceptShiftId ? { id: { not: exceptShiftId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  // The members among `memberIds` that belong to the organization and are not deactivated.
  liveMembers(
    organizationId: string,
    memberIds: readonly string[],
    client: Client = this.prisma,
  ): Promise<{ id: string; userId: string }[]> {
    return client.organizationMember.findMany({
      where: { organizationId, id: { in: [...memberIds] }, deactivatedAt: null },
      select: { id: true, userId: true },
    });
  }

  insertShift(
    data: {
      organizationId: string;
      startsAt: Date;
      endsAt: Date;
      primaryMemberId: string | null;
      backupMemberId: string | null;
      createdById: string;
    },
    client: Client,
  ): Promise<ShiftRow> {
    return client.rosterShift.create({ data, select: SHIFT_SELECT });
  }

  updateShift(
    shiftId: string,
    data: {
      startsAt?: Date;
      endsAt?: Date;
      primaryMemberId?: string | null;
      backupMemberId?: string | null;
    },
    client: Client,
  ): Promise<ShiftRow> {
    return client.rosterShift.update({ where: { id: shiftId }, data, select: SHIFT_SELECT });
  }

  async deleteShift(shiftId: string, client: Client): Promise<void> {
    await client.rosterShift.delete({ where: { id: shiftId } });
  }
}

const SHIFT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  primaryMember: { select: { id: true, userId: true } },
  backupMember: { select: { id: true, userId: true } },
} satisfies Prisma.RosterShiftSelect;

export type ShiftRow = Prisma.RosterShiftGetPayload<{ select: typeof SHIFT_SELECT }>;
