import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ExitBlockingReason,
  ORGANIZATION_EXIT_CHECKS,
  OrganizationExitCheck,
} from '../../organizations';
import { ContractsService } from '../contracts.service';

// rentals' provider of the organizations port ORGANIZATION_EXIT_CHECKS (organizations design §2 and §5,
// REQ-ERR-04): an organization with a contract that is not finished may not close (409
// OPEN_CONTRACTS). It reads in the closing transaction `organizations` passes. Reactivation is
// `billing`'s check, so this one has no view on it. It adds itself to the array of the port when the
// module starts; without the port (a module test) it registers nowhere.
@Injectable()
export class RentalsOrganizationExitCheck implements OrganizationExitCheck {
  constructor(
    private readonly contracts: ContractsService,
    @Optional() @Inject(ORGANIZATION_EXIT_CHECKS) checks?: OrganizationExitCheck[],
  ) {
    checks?.push(this);
  }

  canReactivate(): Promise<ExitBlockingReason | null> {
    return Promise.resolve(null);
  }

  async canClose(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ExitBlockingReason | null> {
    return (await this.contracts.canClose(organizationId, tx))
      ? null
      : { code: 'OPEN_CONTRACTS', message: 'This cannot be done while it has open contracts.' };
  }
}
