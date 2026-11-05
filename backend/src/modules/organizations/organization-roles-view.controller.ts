import { subject } from '@casl/ability';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { OrganizationRolesViewService } from './organization-roles-view.service';

// api-design 33: the read-only roles of one organization for the page `/t/organizations/:id`.
// `organizationRole.read` is held by TrekLink Staff and, through FR-AUTH-10, by Admin, with no
// condition. A Manager holds `organizationRole.manage.own`, which also covers `read` but only for its
// own organization, so the policy asks for an organization nobody owns: only an unconditional rule
// passes, and a Manager answers 403 like an Operator (REQ-EVT-14).
const NO_ORGANIZATION = '00000000-0000-0000-0000-000000000000';

@Controller('organizations')
export class OrganizationRolesViewController {
  constructor(private readonly roles: OrganizationRolesViewService) {}

  @Get(':id/roles')
  @CheckPolicies((ability) =>
    ability.can('read', subject('OrganizationRole', { organizationId: NO_ORGANIZATION })),
  )
  @ResponseMessage('OK')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.view(id);
  }
}
