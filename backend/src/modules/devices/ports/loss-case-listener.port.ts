import { LossCustody, LossDecision, Prisma } from '@prisma/client';

// The loss-case port of devices design §3 (task 1.4 part, declared by LongLP for billing 2.6): the
// modules that react to a loss case without being imported by `devices`. `billing` charges the
// remaining value when a RENTER-custody case is confirmed and adjusts it when the case is settled
// reduced or waived; `rentals` sets the row's `lostAt` when it is settled. Both run inside the
// loss-case transaction. Several modules provide it, so `devices` injects it as an optional array.
//
// Nest has no multi-provider, so `DevicesModule` provides one array under the token (task 1.4) and
// each contributor adds itself when its module starts:
//
//   constructor(@Inject(LOSS_CASE_LISTENERS) private readonly listeners: LossCaseListener[]) {}
//   onModuleInit() { registerLossCaseListener(this.listeners, this); }
//
// `LossCaseNotifier` calls them in registration order; the loss-case flow (task 2.7) is its caller.
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
  // The settlement time; null before the case is settled. Billing dates the ADJUSTMENT line with it.
  settledAt: Date | null;
}

export interface LossCaseListener {
  onConfirmed(lossCase: LossCaseView, tx: Prisma.TransactionClient): Promise<void>;
  onSettled(
    lossCase: LossCaseView,
    decision: LossDecision,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
}

// Adds a listener once; a second registration of the same instance is ignored.
export const registerLossCaseListener = (
  listeners: LossCaseListener[],
  listener: LossCaseListener,
): void => {
  if (!listeners.includes(listener)) listeners.push(listener);
};
