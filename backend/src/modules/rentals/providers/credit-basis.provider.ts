import { Injectable } from '@nestjs/common';
import { PlanType, Prisma } from '@prisma/client';
import { CreditBasis } from '../../billing';
import { ContractsRepository } from '../contracts.repository';
import { FaultReportsRepository } from '../fault-reports.repository';

// Provides billing's CREDIT_BASIS (billing design §9, task 8.1): the contract's price snapshot and
// terms, and the unit's custody times on the contract, read in the caller's transaction.
@Injectable()
export class RentalsCreditBasis implements CreditBasis {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly faults: FaultReportsRepository,
  ) {}

  // The release behind each RELEASE credit (billing design §12.1).
  async releaseNotes(ids: readonly string[]) {
    const rows = await this.contracts.releaseNotes(ids);
    return new Map(rows.map((row) => [row.id, { reason: row.reason, releasedAt: row.releasedAt }]));
  }

  faultReportSource(
    reportId: string,
    contractId: string,
    contractDeviceId: string,
    tx: Prisma.TransactionClient,
  ) {
    return this.faults.sourceOf(reportId, contractId, contractDeviceId, tx);
  }

  async basisOf(contractId: string, contractDeviceId: string, tx: Prisma.TransactionClient) {
    const found = await this.contracts.creditBasis(contractId, contractDeviceId, tx);
    if (!found) return null;
    const { contract, unit } = found;
    return {
      contract: {
        id: contract.id,
        organizationId: contract.organizationId,
        status: contract.status,
        planType: contract.planType === PlanType.DAY ? ('DAY' as const) : ('MONTHLY' as const),
        monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
        dayPremium: contract.dayPremium,
        dayPlanDays: contract.dayPlanDays,
        noticeGivenAt: contract.noticeGivenAt,
        terms: contract.terms.map((term) => ({
          seq: term.seq,
          startsAt: term.startsAt,
          endsAt: term.endsAt,
          invoiced: term.invoice !== null,
        })),
      },
      unit: {
        contractDeviceId: unit.id,
        deviceId: unit.deviceId,
        handedOverAt: unit.handedOverAt,
        checkedInAt: unit.checkedInAt,
        lostAt: unit.lostAt,
        replacementHandedOverAt: unit.replacedBy?.handedOverAt ?? null,
      },
    };
  }
}
