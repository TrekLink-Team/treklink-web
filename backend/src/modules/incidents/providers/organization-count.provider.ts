import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ORGANIZATION_COUNTS,
  OrganizationCountName,
  OrganizationCountProvider,
} from '../../organizations';
import { IncidentsRepository } from '../incidents.repository';

// incidents' provider of the organizations port ORGANIZATION_COUNTS (api-design 03): the incidents of an
// organization that are not CLOSED. It adds itself to the array of the port when the module starts;
// without the port (a module test) it registers nowhere.
@Injectable()
export class IncidentsOrganizationCount implements OrganizationCountProvider {
  readonly name: OrganizationCountName = 'openIncidents';

  constructor(
    private readonly incidents: IncidentsRepository,
    @Optional() @Inject(ORGANIZATION_COUNTS) counts?: OrganizationCountProvider[],
  ) {
    counts?.push(this);
  }

  count(organizationId: string): Promise<number> {
    return this.incidents.countOpenOfOrganization(organizationId);
  }
}
