import { Injectable } from '@nestjs/common';
import { LossCustody, LossDecision, Prisma } from '@prisma/client';
import { DevicesService, LossCaseListener, LossCaseView } from '../../devices';
import { ChargesService } from '../charges.service';

// billing's side of the devices port LOSS_CASE_LISTENERS (task 2.6, REQ-EVT-07, D-045): a case
// confirmed in RENTER custody is charged the device's remaining value at the confirmation date; a
// case settled as reduced or waived gets its ADJUSTMENT line. TREKLINK custody charges nothing.
// Registered under the token once devices 1.4 wires the multi-provider, with the rentals listener.
@Injectable()
export class BillingLossCaseListener implements LossCaseListener {
  constructor(
    private readonly charges: ChargesService,
    private readonly devices: DevicesService,
  ) {}

  async onConfirmed(lossCase: LossCaseView, tx: Prisma.TransactionClient): Promise<void> {
    const contract = lossCase.custodyContract;
    if (lossCase.custody !== LossCustody.RENTER || !contract || !lossCase.confirmedAt) return;
    const value = await this.devices.valueAt(lossCase.deviceId, lossCase.confirmedAt);
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
    await this.charges.adjustLoss(
      { id: contract.contractId, organizationId: contract.organizationId },
      { id: lossCase.deviceId, assetTag: lossCase.assetTag },
      decision,
      lossCase.chargeVnd ?? 0,
      lossCase.decisionReason ?? 'decided by TrekLink',
      lossCase.decidedById,
      tx,
    );
  }
}
