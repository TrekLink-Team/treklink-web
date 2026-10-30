import { Injectable } from '@nestjs/common';
import { DamageChargeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const DAMAGE_CHARGE_SELECT = {
  id: true,
  inspectionId: true,
  deviceId: true,
  contractId: true,
  inspectorId: true,
  damageCodes: true,
  amountVnd: true,
  finalVnd: true,
  status: true,
  decidedById: true,
  decisionNote: true,
  decidedAt: true,
  createdAt: true,
} satisfies Prisma.DamageChargeSelect;

export type DamageChargeRow = Prisma.DamageChargeGetPayload<{
  select: typeof DAMAGE_CHARGE_SELECT;
}>;

export interface NewDamageCharge {
  inspectionId: string;
  deviceId: string;
  // D-081: the contract and the inspector, from the values `chargeDamage` already receives.
  contractId: string;
  inspectorId: string;
  damageCodes: string[];
  amountVnd: bigint;
  status: typeof DamageChargeStatus.PENDING_APPROVAL | typeof DamageChargeStatus.APPROVED;
  // Set only for a charge approved at once, below the approval threshold.
  finalVnd: bigint | null;
  decidedAt: Date | null;
}

export interface DamageChargeFilter {
  status?: DamageChargeStatus;
  contractId?: string;
}

export interface DamageDecision {
  status:
    | typeof DamageChargeStatus.APPROVED
    | typeof DamageChargeStatus.REDUCED
    | typeof DamageChargeStatus.WAIVED;
  finalVnd: bigint;
  decidedById: string;
  decisionNote: string;
  decidedAt: Date;
}

// The only class of `billing` that touches DamageCharge (D-044 rule 4, billing task 2.5).
@Injectable()
export class DamageChargesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Charges of the contract still waiting for an Admin (rentals close, api-design 17; balance 10).
  pendingOfContract(contractId: string, client: Client = this.prisma): Promise<DamageChargeRow[]> {
    return client.damageCharge.findMany({
      where: { contractId, status: DamageChargeStatus.PENDING_APPROVAL },
      orderBy: { createdAt: 'asc' },
      select: DAMAGE_CHARGE_SELECT,
    });
  }

  insert(charge: NewDamageCharge, tx: Prisma.TransactionClient): Promise<DamageChargeRow> {
    return tx.damageCharge.create({ data: charge, select: DAMAGE_CHARGE_SELECT });
  }

  // The charge under a row lock, so two Admins deciding at once take turns (api-design 17).
  async lock(id: string, tx: Prisma.TransactionClient): Promise<DamageChargeRow | null> {
    await tx.$queryRaw`SELECT "id" FROM "damage_charges" WHERE "id" = ${id} FOR UPDATE`;
    return tx.damageCharge.findUnique({ where: { id }, select: DAMAGE_CHARGE_SELECT });
  }

  recordDecision(
    id: string,
    decision: DamageDecision,
    tx: Prisma.TransactionClient,
  ): Promise<DamageChargeRow> {
    return tx.damageCharge.update({ where: { id }, data: decision, select: DAMAGE_CHARGE_SELECT });
  }

  // One page of charges, newest first (api-design 16).
  page(
    filter: DamageChargeFilter,
    skip: number,
    take: number,
  ): Promise<[DamageChargeRow[], number]> {
    const where = { status: filter.status, contractId: filter.contractId };
    return this.prisma.$transaction([
      this.prisma.damageCharge.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: DAMAGE_CHARGE_SELECT,
      }),
      this.prisma.damageCharge.count({ where }),
    ]);
  }
}
