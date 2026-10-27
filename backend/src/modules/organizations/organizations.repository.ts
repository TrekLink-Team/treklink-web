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

  // The head of organizations api-design 03; the verification record and the counts join with task 2.4.
  findSummary(id: string, client: Client = this.prisma) {
    return client.organization.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        legalName: true,
        status: true,
        statusChangedAt: true,
        channelKeyVersion: true,
        version: true,
      },
    });
  }

  async channelKeyVersion(id: string, client: Client = this.prisma): Promise<number | null> {
    const row = await client.organization.findUnique({
      where: { id },
      select: { channelKeyVersion: true },
    });
    return row?.channelKeyVersion ?? null;
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
