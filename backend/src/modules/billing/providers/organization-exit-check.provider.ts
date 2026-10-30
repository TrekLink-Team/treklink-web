import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ExitBlockingReason,
  ORGANIZATION_EXIT_CHECKS,
  OrganizationExitCheck,
} from '../../organizations';
import { BalanceService } from '../balance.service';

// billing's provider of the organizations port ORGANIZATION_EXIT_CHECKS (organizations design §2 and
// §5, billing design §6, REQ-ERR-04): a suspended organization is reactivated only when nothing is
// outstanding across its contracts (409 BALANCE_OUTSTANDING). It reads in the transaction
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
  ): Promise<ExitBlockingReason | null> {
    return (await this.balances.outstandingOfOrganization(organizationId, tx)) > 0n
      ? { code: 'BALANCE_OUTSTANDING', message: 'This cannot be done while it has open balances.' }
      : null;
  }

  canClose(): Promise<ExitBlockingReason | null> {
    return Promise.resolve(null);
  }
}
