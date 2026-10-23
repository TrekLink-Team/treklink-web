import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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
}
