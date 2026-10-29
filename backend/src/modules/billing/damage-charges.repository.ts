import { Injectable } from '@nestjs/common';
import { DamageChargeStatus, Prisma } from '@prisma/client';

export const DAMAGE_CHARGE_SELECT = {
  id: true,
  inspectionId: true,
  deviceId: true,
  amountVnd: true,
  finalVnd: true,
  status: true,
  decidedById: true,
  decidedAt: true,
} satisfies Prisma.DamageChargeSelect;

export type DamageChargeRow = Prisma.DamageChargeGetPayload<{
  select: typeof DAMAGE_CHARGE_SELECT;
}>;

export interface NewDamageCharge {
  inspectionId: string;
  deviceId: string;
  amountVnd: bigint;
  status: typeof DamageChargeStatus.PENDING_APPROVAL | typeof DamageChargeStatus.APPROVED;
  // Set only for a charge approved at once, below the approval threshold.
  finalVnd: bigint | null;
  decidedAt: Date | null;
}

// The only class of `billing` that touches DamageCharge (D-044 rule 4, billing task 2.5).
@Injectable()
export class DamageChargesRepository {
  // Charges still waiting for an Admin on these devices since `since` (rentals close, api-design 17).
  countPending(deviceIds: readonly string[], since: Date, tx: Prisma.TransactionClient) {
    return tx.damageCharge.count({
      where: {
        deviceId: { in: [...deviceIds] },
        status: DamageChargeStatus.PENDING_APPROVAL,
        createdAt: { gte: since },
      },
    });
  }

  insert(charge: NewDamageCharge, tx: Prisma.TransactionClient): Promise<DamageChargeRow> {
    return tx.damageCharge.create({ data: charge, select: DAMAGE_CHARGE_SELECT });
  }
}
