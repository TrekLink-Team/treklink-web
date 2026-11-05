import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  CheckPolicies,
  CurrentAbility,
  type PolicyAbility,
} from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { OrganizationRolesViewService } from './organization-roles-view.service';

// api-design 33: the read-only roles of one organization for the page `/t/organizations/:id`.
// `organizationRole.read` is held by TrekLink Staff and, through FR-AUTH-10, by Admin.
@Controller('organizations')
export class OrganizationRolesViewController {
  constructor(private readonly roles: OrganizationRolesViewService) {}

  @Get(':id/roles')
  @CheckPolicies((ability) => ability.can('read', 'OrganizationRole'))
  @ResponseMessage('OK')
  view(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ability: PolicyAbility) {
    return this.roles.view(id, ability);
  }
}
