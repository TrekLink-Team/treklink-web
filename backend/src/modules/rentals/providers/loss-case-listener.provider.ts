import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { LossDecision, Prisma } from '@prisma/client';
import {
  LOSS_CASE_LISTENERS,
  LossCaseListener,
  LossCaseView,
  registerLossCaseListener,
} from '../../devices';
import { ContractsService } from '../contracts.service';

// rentals' side of the devices port LOSS_CASE_LISTENERS (task 1.3, REQ-EVT-12, D-045): a settled
// case in RENTER custody ends the contract row's interval at the confirmation time, whatever the
// decision, inside the loss-case transaction. A confirmation changes nothing for rentals. Registers
// itself under LOSS_CASE_LISTENERS at boot, as BillingLossCaseListener does.
@Injectable()
export class RentalsLossCaseListener implements LossCaseListener, OnModuleInit {
  constructor(
    private readonly contracts: ContractsService,
    // Required: devices provides the array, and a missing token must fail at boot, never leave
    // rentals silently unregistered (no lostAt on a settled case).
    @Inject(LOSS_CASE_LISTENERS)
    private readonly listeners: LossCaseListener[],
  ) {}

  onModuleInit(): void {
    registerLossCaseListener(this.listeners, this);
  }

  async onConfirmed(): Promise<void> {}

  async onSettled(
    lossCase: LossCaseView,
    _decision: LossDecision,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const contract = lossCase.custodyContract;
    if (!contract || !lossCase.confirmedAt) return;
    await this.contracts.onLossSettled(contract.contractDeviceId, lossCase.confirmedAt, tx);
  }
}
