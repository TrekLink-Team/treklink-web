import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class FaultReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockOwnContract(contractId: string, organizationId: string, tx: Prisma.TransactionClient) {
    // Conflicts with custody writers' contract locks, while allowing other inserts to reference
    // the contract. In particular, recording a loss writes the device before linking its contract.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "rental_contracts"
      WHERE "id" = ${contractId} AND "organizationId" = ${organizationId}
      FOR NO KEY UPDATE
    `;
    return rows.length > 0;
  }

  latestCustody(contractId: string, deviceId: string, tx: Prisma.TransactionClient) {
    return tx.contractDevice.findFirst({
      where: { contractId, deviceId },
      orderBy: [{ reservedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        handedOverAt: true,
        checkedInAt: true,
        lostAt: true,
        releasedAt: true,
        replacedBy: { select: { id: true } },
        faultReports: { where: { resolvedAt: null }, select: { id: true }, take: 1 },
      },
    });
  }

  insert(data: Prisma.DeviceFaultReportUncheckedCreateInput, tx: Prisma.TransactionClient) {
    return tx.deviceFaultReport.create({ data });
  }

  async ofContract(contractId: string, organizationId: string | null) {
    const contract = await this.prisma.rentalContract.findFirst({
      where: { id: contractId, ...(organizationId === null ? {} : { organizationId }) },
      select: {
        deviceFaultReports: {
          orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            deviceId: true,
            description: true,
            reportedAt: true,
            resolvedAt: true,
            resolution: true,
          },
        },
      },
    });
    return contract?.deviceFaultReports ?? null;
  }

  sourceOf(
    reportId: string,
    contractId: string,
    contractDeviceId: string,
    tx: Prisma.TransactionClient,
  ) {
    return tx.deviceFaultReport.findFirst({
      where: { id: reportId, contractId, contractDeviceId },
      select: { reportedAt: true },
    });
  }
}
