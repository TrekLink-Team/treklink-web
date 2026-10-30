import { Injectable } from '@nestjs/common';
import { MemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export interface MemberRow {
  id: string;
  userId: string;
  role: MemberRole;
  deactivatedAt: Date | null;
}

export interface LiveMembership {
  organizationId: string;
  organizationCode: string;
  legalName: string;
  memberRole: 'MANAGER' | 'OPERATOR';
  organizationStatus: string;
}

// Membership reads over the `organizations` models (task 1.1 grows this into the full repository).
@Injectable()
export class MembersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The member row of an account that is not deactivated, with its organization; null otherwise.
  async findLiveMembership(userId: string): Promise<LiveMembership | null> {
    const row = await this.prisma.organizationMember.findFirst({
      where: { userId, deactivatedAt: null },
      select: {
        role: true,
        organization: { select: { id: true, code: true, legalName: true, status: true } },
      },
    });
    if (!row) return null;
    return {
      organizationId: row.organization.id,
      organizationCode: row.organization.code,
      legalName: row.organization.legalName,
      memberRole: row.role,
      organizationStatus: row.organization.status,
    };
  }

  // The organization of each listed account that has a member row, deactivated or not.
  async organizationsOfUsers(
    userIds: readonly string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.organizationMember.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, organization: { select: { id: true, legalName: true } } },
    });
    return new Map(
      rows.map((row) => [
        row.userId,
        { id: row.organization.id, name: row.organization.legalName },
      ]),
    );
  }

  // The members of an organization, Managers first (organizations api-design 12).
  membersOf(
    organizationId: string,
    includeDeactivated: boolean,
    client: Client = this.prisma,
  ): Promise<MemberRow[]> {
    return client.organizationMember.findMany({
      where: { organizationId, ...(includeDeactivated ? {} : { deactivatedAt: null }) },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, userId: true, role: true, deactivatedAt: true },
    });
  }

  // The live member row of an account in one organization, or null.
  findLiveMember(
    organizationId: string,
    userId: string,
    client: Client = this.prisma,
  ): Promise<MemberRow | null> {
    return client.organizationMember.findFirst({
      where: { organizationId, userId, deactivatedAt: null },
      select: { id: true, userId: true, role: true, deactivatedAt: true },
    });
  }

  // The first Manager of a newly registered organization (task 2.1), or a member a Manager invited
  // (task 2.5, `invitedById`).
  addMember(
    row: { organizationId: string; userId: string; role: MemberRole; invitedById?: string },
    client: Client,
  ): Promise<MemberRow> {
    return client.organizationMember.create({
      data: row,
      select: { id: true, userId: true, role: true, deactivatedAt: true },
    });
  }

  // A member row by id inside one organization, deactivated or not; null for another organization's.
  findInOrganization(
    organizationId: string,
    memberId: string,
    client: Client = this.prisma,
  ): Promise<MemberRow | null> {
    return client.organizationMember.findFirst({
      where: { id: memberId, organizationId },
      select: { id: true, userId: true, role: true, deactivatedAt: true },
    });
  }

  // Account ids of the organization's members who are not deactivated and hold the Manager role. Whether
  // each account has set its password is `auth`'s to say.
  async liveManagerUserIds(
    organizationId: string,
    client: Client = this.prisma,
  ): Promise<string[]> {
    const rows = await client.organizationMember.findMany({
      where: { organizationId, role: MemberRole.MANAGER, deactivatedAt: null },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  setRole(memberId: string, role: MemberRole, client: Client): Promise<MemberRow> {
    return client.organizationMember.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, userId: true, role: true, deactivatedAt: true },
    });
  }

  markDeactivated(memberId: string, at: Date, client: Client): Promise<MemberRow> {
    return client.organizationMember.update({
      where: { id: memberId },
      data: { deactivatedAt: at },
      select: { id: true, userId: true, role: true, deactivatedAt: true },
    });
  }
}
