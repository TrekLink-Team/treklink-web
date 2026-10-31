import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ContractStatus, LossDecision, Prisma } from '@prisma/client';
import {
  LOSS_CASE_LISTENERS,
  LossCaseListener,
  LossCaseView,
  registerLossCaseListener,
} from '../../devices';
import { ContractLifecycleService } from '../contract-lifecycle.service';
import { ContractsRepository } from '../contracts.repository';
import { ContractsService } from '../contracts.service';
import { DUE } from '../return.service';

// rentals' side of the devices port LOSS_CASE_LISTENERS (task 1.3, REQ-EVT-12, D-045): a settled
// case in RENTER custody ends the contract row's interval at the confirmation time, whatever the
// decision, inside the loss-case transaction. When that leaves no device of a RETURN_DUE, OVERDUE or
// DEFAULTED contract out, the contract moves to RETURNED with reason LOST in the same transaction, as
// the last check-in does (design §2); an ACTIVE or ENDING contract keeps running. A confirmation
// changes nothing for rentals. Registers itself under LOSS_CASE_LISTENERS at boot, as
// BillingLossCaseListener does.
@Injectable()
export class RentalsLossCaseListener implements LossCaseListener, OnModuleInit {
  constructor(
    private readonly contracts: ContractsService,
    // Required: devices provides the array, and a missing token must fail at boot, never leave
    // rentals silently unregistered (no lostAt on a settled case).
    @Inject(LOSS_CASE_LISTENERS)
    private readonly listeners: LossCaseListener[],
    private readonly repository: ContractsRepository,
    private readonly lifecycle: ContractLifecycleService,
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

    const current = await this.repository.lockById(contract.contractId, tx);
    if (!DUE.includes(current.status)) return;
    const { total, returned } = await this.repository.returnCounts(contract.contractId, tx);
    if (returned !== total) return;
    // The deciding Admin; the listener does not see the roles, so the audit names the account only.
    const actor = lossCase.decidedById
      ? { id: lossCase.decidedById, roles: [], organizationId: null }
      : null;
    await this.lifecycle.apply(
      contract.contractId,
      current.status,
      ContractStatus.RETURNED,
      'LOST',
      actor,
      tx,
    );
  }
}
