import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ExitBlockingReason,
  ORGANIZATION_EXIT_CHECKS,
  OrganizationExitCheck,
} from '../../organizations';
import { BalanceService } from '../balance.service';

// billing's provider of the organizations port ORGANIZATION_EXIT_CHECKS (organizations design §2 and
// §5, billing design §6, REQ-ERR-04): a suspended organization is reactivated only when no invoice line
// of its contracts is due and unpaid at the reactivation time and no damage charge of theirs waits for
// an Admin (billing task 1.3, 409 BALANCE_OUTSTANDING). A line not yet due, such as the second
// installment of a term, does not block (leader ruling 2026-10-30). It reads in the transaction
// `organizations` passes. Closing is `rentals`' check, so this one has no view on it. It adds itself
// to the array of the port when the module starts; without the port (a module test) it registers
// nowhere.
@Injectable()
export class BillingOrganizationExitCheck implements OrganizationExitCheck {
  constructor(
    private readonly balances: BalanceService,
    @Optional() @Inject(ORGANIZATION_EXIT_CHECKS) checks?: OrganizationExitCheck[],
  ) {
    checks?.push(this);
  }

  async canReactivate(
    organizationId: string,
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<ExitBlockingReason | null> {
    const owed = await this.balances.dueUnpaidOfOrganization(organizationId, at, tx);
    const pending =
      owed > 0n ? 0 : await this.balances.pendingDamageOfOrganization(organizationId, tx);
    return owed > 0n || pending > 0
      ? { code: 'BALANCE_OUTSTANDING', message: 'This cannot be done while it has open balances.' }
      : null;
  }

  canClose(): Promise<ExitBlockingReason | null> {
    return Promise.resolve(null);
  }
}
