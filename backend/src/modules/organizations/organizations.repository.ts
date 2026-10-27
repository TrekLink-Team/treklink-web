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

  // Onboarding (tasks 2.1 to 2.3, built by LongLP for Review 2): the list, registration, verification
  // and the Admin decision. The row the review queue shows.
  page(
    filter: { status?: OrganizationStatus; q?: string },
    skip: number,
    take: number,
    client: Client = this.prisma,
  ) {
    const where: Prisma.OrganizationWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { legalName: { contains: filter.q, mode: 'insensitive' } },
              { code: { contains: filter.q, mode: 'insensitive' } },
              { taxCode: { contains: filter.q } },
            ],
          }
        : {}),
    };
    return Promise.all([
      client.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: REVIEW_SELECT,
      }),
      client.organization.count({ where }),
    ]);
  }

  // The next ORG- code: the highest numeric suffix plus one, read in the caller's transaction. Two
  // registrations at the same moment can pick the same code; the unique index refuses the second,
  // which answers 409 CONFLICT_UNIQUE, and the Manager submits again.
  async nextCode(client: Client): Promise<string> {
    const rows = await client.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING(code FROM 5) AS INTEGER)) AS max
      FROM organizations WHERE code ~ '^ORG-[0-9]+$'`;
    const next = Number(rows[0]?.max ?? 0) + 1;
    return `ORG-${String(next).padStart(4, '0')}`;
  }

  createPending(
    data: {
      code: string;
      legalName: string;
      taxCode: string;
      address: string;
      contactEmail: string;
      contactPhone: string;
    },
    client: Client,
  ) {
    return client.organization.create({ data, select: REVIEW_SELECT });
  }

  taxCodeTaken(taxCode: string, client: Client = this.prisma): Promise<boolean> {
    return client.organization.count({ where: { taxCode } }).then((count) => count > 0);
  }

  async lockById(id: string, client: Client) {
    await client.$queryRaw`SELECT id FROM organizations WHERE id = ${id} FOR UPDATE`;
    return client.organization.findUnique({ where: { id }, select: REVIEW_SELECT });
  }

  // Compare-and-set on version: null when someone else saved first.
  async update(
    id: string,
    expectedVersion: number,
    data: Prisma.OrganizationUpdateManyMutationInput & {
      verifiedById?: string;
      decidedById?: string;
    },
    client: Client,
  ) {
    const { count } = await client.organization.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) return null;
    return client.organization.findUnique({ where: { id }, select: REVIEW_SELECT });
  }

  addTransition(
    row: {
      organizationId: string;
      fromStatus: OrganizationStatus | null;
      toStatus: OrganizationStatus;
      actorId: string | null;
      reason?: string | null;
    },
    client: Client,
  ) {
    return client.organizationTransition.create({ data: row });
  }
}

export interface OrganizationLabel {
  id: string;
  code: string;
  legalName: string;
}

export const REVIEW_SELECT = {
  id: true,
  code: true,
  legalName: true,
  taxCode: true,
  address: true,
  contactEmail: true,
  contactPhone: true,
  status: true,
  statusChangedAt: true,
  verifiedAt: true,
  verificationMethod: true,
  documentsSeen: true,
  masterContractRef: true,
  ndaSigned: true,
  softwareLicenceSigned: true,
  decidedAt: true,
  rejectionReason: true,
  channelKeyVersion: true,
  version: true,
  createdAt: true,
} satisfies Prisma.OrganizationSelect;

export type OrganizationReviewRow = Prisma.OrganizationGetPayload<{ select: typeof REVIEW_SELECT }>;
