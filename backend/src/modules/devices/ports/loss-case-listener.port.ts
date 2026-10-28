import { LossCustody, LossDecision, Prisma } from '@prisma/client';

// The loss-case port of devices design §3 (task 1.4 part, declared by LongLP for billing 2.6): the
// modules that react to a loss case without being imported by `devices`. `billing` charges the
// remaining value when a RENTER-custody case is confirmed and adjusts it when the case is settled
// reduced or waived; `rentals` sets the row's `lostAt` when it is settled. Both run inside the
// loss-case transaction. Several modules provide it, so `devices` injects it as an optional array.
export const LOSS_CASE_LISTENERS = Symbol('LOSS_CASE_LISTENERS');

// A loss case as its listeners see it. `custodyContract` is the interval CUSTODY_RESOLVER found at
// triage, present for RENTER custody only.
export interface LossCaseView {
  id: string;
  code: string;
  deviceId: string;
  assetTag: string;
  custody: LossCustody | null;
  custodyContract: { contractId: string; organizationId: string; contractDeviceId: string } | null;
  confirmedAt: Date | null;
  // The amount charged after the decision; null before it.
  chargeVnd: number | null;
  decisionReason: string | null;
  decidedById: string | null;
}

export interface LossCaseListener {
  onConfirmed(lossCase: LossCaseView, tx: Prisma.TransactionClient): Promise<void>;
  onSettled(
    lossCase: LossCaseView,
    decision: LossDecision,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
}
