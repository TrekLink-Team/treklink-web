import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ORGANIZATION_COUNTS,
  OrganizationCountName,
  OrganizationCountProvider,
} from '../../organizations';
import { ContractsService } from '../contracts.service';

// rentals' provider of the organizations port ORGANIZATION_COUNTS (api-design 03): the contracts whose
// devices are out. It adds itself to the array of the port when the module starts; without the port
// (a module test) it registers nowhere.
@Injectable()
export class RentalsOrganizationCount implements OrganizationCountProvider {
  readonly name: OrganizationCountName = 'runningContracts';

  constructor(
    private readonly contracts: ContractsService,
    @Optional() @Inject(ORGANIZATION_COUNTS) counts?: OrganizationCountProvider[],
  ) {
    counts?.push(this);
  }

  count(organizationId: string): Promise<number> {
    return this.contracts.countRunning(organizationId);
  }
}
