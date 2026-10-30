import { Inject, Injectable, Optional } from '@nestjs/common';
import { LossDecision, Prisma } from '@prisma/client';
import {
  LOSS_CASE_LISTENERS,
  LossCaseListener,
  LossCaseView,
} from './ports/loss-case-listener.port';

// The call site of the LOSS_CASE_LISTENERS port (task 1.4, design §3): every listener runs inside the
// caller's loss-case transaction, in registration order, so a listener that throws rolls the
// confirmation or settlement back. The loss-case service (task 2.7) calls `confirmed` when Staff or
// the `devices.lossSearch` job confirm a case and `settled` when an Admin decides it.
@Injectable()
export class LossCaseNotifier {
  constructor(
    @Optional()
    @Inject(LOSS_CASE_LISTENERS)
    private readonly listeners: LossCaseListener[] | null,
  ) {}

  async confirmed(lossCase: LossCaseView, tx: Prisma.TransactionClient): Promise<void> {
    for (const listener of this.listeners ?? []) await listener.onConfirmed(lossCase, tx);
  }

  async settled(
    lossCase: LossCaseView,
    decision: LossDecision,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const listener of this.listeners ?? []) {
      await listener.onSettled(lossCase, decision, tx);
    }
  }
}
