import { subject } from '@casl/ability';
import { HttpStatus, Injectable } from '@nestjs/common';
import { type PolicyAbility } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { OrganizationRolePolicyService, OrganizationRolesResult } from '../auth';
import { OrganizationsRepository } from './organizations.repository';

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

// The roles and permissions of one organization, read only (api-design 33, D-095). TrekLink Staff and
// Admin read any organization (`organizationRole.read`); a Manager reads its own, which the Manager
// already has on auth api-design 19, and another organization's reads as unknown. The view itself is
// the read service of `auth`.
@Injectable()
export class OrganizationRolesViewService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly policies: OrganizationRolePolicyService,
  ) {}

  async view(organizationId: string, ability: PolicyAbility): Promise<OrganizationRolesResult> {
    if (!ability.can('read', subject('OrganizationRole', { organizationId }))) throw notFound();
    if ((await this.organizations.findStatus(organizationId)) === null) throw notFound();
    return this.policies.viewOf(organizationId);
  }
}
