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
}
