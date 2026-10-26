import { Injectable } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

// Organization reads (task 1.1 grows this into the full repository). Only the status read that
// `assertActive` needs exists so far.
@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findStatus(id: string, client: Client = this.prisma): Promise<OrganizationStatus | null> {
    const row = await client.organization.findUnique({ where: { id }, select: { status: true } });
    return row?.status ?? null;
  }

  labels(ids: readonly string[], client: Client = this.prisma): Promise<OrganizationLabel[]> {
    return client.organization.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, legalName: true },
    });
  }
}

export interface OrganizationLabel {
  id: string;
  code: string;
  legalName: string;
}
