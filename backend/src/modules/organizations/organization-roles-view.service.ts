import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';
import { OrganizationRolePolicyService, OrganizationRolesResult } from '../auth';
import { OrganizationsRepository } from './organizations.repository';

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

// The roles and permissions of one organization, read only (api-design 33, D-095). Only TrekLink
// Staff and Admin reach it (`organizationRole.read`, decided by the controller); a Manager reads its
// own organization on auth api-design 19. The view itself is the read service of `auth`.
@Injectable()
export class OrganizationRolesViewService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly policies: OrganizationRolePolicyService,
  ) {}

  async view(organizationId: string): Promise<OrganizationRolesResult> {
    if ((await this.organizations.findStatus(organizationId)) === null) throw notFound();
    return this.policies.viewOf(organizationId);
  }
}
