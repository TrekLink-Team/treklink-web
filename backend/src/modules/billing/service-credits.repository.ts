import { Injectable } from '@nestjs/common';
import { Prisma, ServiceCreditCause, ServiceCreditStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const SERVICE_CREDIT_SELECT = {
  id: true,
  contractId: true,
  organizationId: true,
  contractDeviceId: true,
  deviceId: true,
  cause: true,
  faultInspectionId: true,
  outageFrom: true,
  outageSourceIncidentId: true,
  outageSourceFaultReportId: true,
  outageSourceNote: true,
  outageTo: true,
  outageDays: true,
  computedVnd: true,
  decidedVnd: true,
  appliedVnd: true,
  status: true,
  requestedById: true,
  decidedById: true,
  decisionReason: true,
  decidedAt: true,
  refundReference: true,
  refundedAt: true,
  version: true,
  createdAt: true,
} satisfies Prisma.ServiceCreditSelect;

export type ServiceCreditRow = Prisma.ServiceCreditGetPayload<{
  select: typeof SERVICE_CREDIT_SELECT;
}>;

export interface NewServiceCredit {
  contractId: string;
  organizationId: string;
  contractDeviceId: string;
  deviceId: string;
  cause: ServiceCreditCause;
  faultInspectionId: string;
  outageFrom: Date;
  outageSourceIncidentId: string | null;
  outageSourceFaultReportId: string | null;
  outageSourceNote: string | null;
  outageTo: Date;
  outageDays: number;
  computedVnd: bigint;
  requestedById: string;
}

export interface ServiceCreditFilter {
  status?: ServiceCreditStatus;
  contractId?: string;
  // the organization's own credits (serviceCredit.read.own)
  organizationId?: string;
}

// The only class of `billing` that touches ServiceCredit (D-044 rule 4, billing task 8.1).
@Injectable()
export class ServiceCreditsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Serializes credit requests per contract row, so two overlapping requests cannot both pass the
  // DUPLICATE_CREDIT check (REQ-ERR-08). An advisory lock: billing does not lock rentals rows.
  async lockUnit(contractDeviceId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:credit:${contractDeviceId}`}))`;
  }

  // A credit of the row, not REJECTED, whose outage overlaps [from, to).
  overlapping(
    contractDeviceId: string,
    from: Date,
    to: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string } | null> {
    return tx.serviceCredit.findFirst({
      where: {
        contractDeviceId,
        status: { not: ServiceCreditStatus.REJECTED },
        outageFrom: { lt: to },
        outageTo: { gt: from },
      },
      select: { id: true },
    });
  }

  insert(credit: NewServiceCredit, tx: Prisma.TransactionClient): Promise<ServiceCreditRow> {
    return tx.serviceCredit.create({
      data: { ...credit, status: ServiceCreditStatus.REQUESTED },
      select: SERVICE_CREDIT_SELECT,
    });
  }

  // The credit under a row lock, so two Admins deciding at once take turns.
  async lock(id: string, tx: Prisma.TransactionClient): Promise<ServiceCreditRow | null> {
    await tx.$queryRaw`SELECT "id" FROM "service_credits" WHERE "id" = ${id} FOR UPDATE`;
    return tx.serviceCredit.findUnique({ where: { id }, select: SERVICE_CREDIT_SELECT });
  }

  update(
    id: string,
    data: Prisma.ServiceCreditUpdateInput,
    tx: Prisma.TransactionClient,
  ): Promise<ServiceCreditRow> {
    return tx.serviceCredit.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
      select: SERVICE_CREDIT_SELECT,
    });
  }

  // APPROVED credits of the contract with an amount still to land, oldest decision first, locked.
  async approvedWithRemainder(
    contractId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ServiceCreditRow[]> {
    await tx.$queryRaw`SELECT "id" FROM "service_credits" WHERE "contractId" = ${contractId} AND "status" = 'APPROVED' FOR UPDATE`;
    return tx.serviceCredit.findMany({
      where: { contractId, status: ServiceCreditStatus.APPROVED },
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
      select: SERVICE_CREDIT_SELECT,
    });
  }

  // REQUESTED credits of the contract: each blocks the close (REQ-STA-02, rentals REQ-EVT-18).
  requestedOfContract(contractId: string, client: Client = this.prisma) {
    return client.serviceCredit.findMany({
      where: { contractId, status: ServiceCreditStatus.REQUESTED },
      orderBy: { createdAt: 'asc' },
      select: { id: true, deviceId: true, computedVnd: true },
    });
  }

  // A refund reference already recorded on another credit (AC-08).
  refundReferenceUsed(reference: string, tx: Prisma.TransactionClient) {
    return tx.serviceCredit.findUnique({
      where: { refundReference: reference },
      select: { id: true },
    });
  }

  find(id: string, client: Client = this.prisma): Promise<ServiceCreditRow | null> {
    return client.serviceCredit.findUnique({ where: { id }, select: SERVICE_CREDIT_SELECT });
  }

  // One page of credits, newest first.
  page(
    filter: ServiceCreditFilter,
    skip: number,
    take: number,
  ): Promise<[ServiceCreditRow[], number]> {
    const where: Prisma.ServiceCreditWhereInput = {
      status: filter.status,
      contractId: filter.contractId,
      organizationId: filter.organizationId,
    };
    return this.prisma.$transaction([
      this.prisma.serviceCredit.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: SERVICE_CREDIT_SELECT,
      }),
      this.prisma.serviceCredit.count({ where }),
    ]);
  }
}
