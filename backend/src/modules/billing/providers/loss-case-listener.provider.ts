import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { LossCustody, LossDecision, Prisma } from '@prisma/client';
import {
  DevicesService,
  LOSS_CASE_LISTENERS,
  LossCaseListener,
  LossCaseView,
  registerLossCaseListener,
} from '../../devices';
import { ChargesService } from '../charges.service';

// billing's side of the devices port LOSS_CASE_LISTENERS (task 2.6, REQ-EVT-07, D-045): a case
// confirmed in RENTER custody is charged the device's remaining value at the confirmation date; a
// case settled as reduced or waived gets its ADJUSTMENT line. TREKLINK custody charges nothing.
// Registers itself under LOSS_CASE_LISTENERS at boot (devices task 1.4 wiring), alongside
// RentalsLossCaseListener (rentals task 1.3).
@Injectable()
export class BillingLossCaseListener implements LossCaseListener, OnModuleInit {
  constructor(
    private readonly charges: ChargesService,
    private readonly devices: DevicesService,
    @Optional()
    @Inject(LOSS_CASE_LISTENERS)
    private readonly listeners?: LossCaseListener[],
  ) {}

  onModuleInit(): void {
    if (this.listeners) registerLossCaseListener(this.listeners, this);
  }

  async onConfirmed(lossCase: LossCaseView, tx: Prisma.TransactionClient): Promise<void> {
    const contract = lossCase.custodyContract;
    if (lossCase.custody !== LossCustody.RENTER || !contract || !lossCase.confirmedAt) return;
    // The charge devices raised at confirmation from the same `valueAt` (devices task 2.7), so the
    // LOSS line always equals the case's `chargeVnd`; read here only when the case carries none.
    const value =
      lossCase.chargeVnd ?? (await this.devices.valueAt(lossCase.deviceId, lossCase.confirmedAt));
    await this.charges.chargeLoss(
      { id: contract.contractId, organizationId: contract.organizationId },
      { id: lossCase.deviceId, assetTag: lossCase.assetTag },
      value,
      lossCase.code,
      lossCase.confirmedAt,
      tx,
    );
  }

  async onSettled(
    lossCase: LossCaseView,
    decision: LossDecision,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const contract = lossCase.custodyContract;
    if (!contract || (decision !== LossDecision.REDUCED && decision !== LossDecision.WAIVED)) {
      return;
    }
    // devices sets settledAt in the same transition that calls onSettled, so the line is dated at it.
    if (!lossCase.settledAt) throw new Error(`Loss case ${lossCase.code} has no settlement time.`);
    await this.charges.adjustLoss(
      { id: contract.contractId, organizationId: contract.organizationId },
      { id: lossCase.deviceId, assetTag: lossCase.assetTag },
      decision,
      lossCase.chargeVnd ?? 0,
      lossCase.decisionReason ?? 'decided by TrekLink',
      lossCase.decidedById,
      tx,
      lossCase.settledAt,
    );
  }
}
