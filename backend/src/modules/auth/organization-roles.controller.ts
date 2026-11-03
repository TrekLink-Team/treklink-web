import { Body, Controller, Get, Headers, Ip, Param, Put } from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { clientInfo } from './auth.controller';
import { ReplaceOrganizationRolePermissionsDto } from './dto/auth.dto';
import {
  OrganizationRolePolicyService,
  OrganizationRoleSaved,
  OrganizationRolesResult,
} from './organization-role-policy.service';

const canManageOrganizationRoles = CheckPolicies((ability) =>
  ability.can('manage', 'OrganizationRole'),
);

// The roles of the caller's own organization (auth task 9.4, api-design 19 and 20, D-095). Org Manager
// only (`organizationRole.manage.own`); the organization comes from the token, never from the path.
@Controller('organization/roles')
@canManageOrganizationRoles
export class OrganizationRolesController {
  constructor(private readonly policies: OrganizationRolePolicyService) {}

  @Get()
  @ResponseMessage('OK')
  view(@CurrentCaller() caller: Caller): Promise<OrganizationRolesResult> {
    return this.policies.view(caller);
  }

  @Put(':roleKey/permissions')
  @ResponseMessage('Permissions updated')
  replace(
    @Param('roleKey') roleKey: string,
    @Body() dto: ReplaceOrganizationRolePermissionsDto,
    @CurrentCaller() caller: Caller,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<OrganizationRoleSaved> {
    return this.policies.replace(
      caller,
      roleKey,
      dto.permissionKeys,
      dto.expectedVersion,
      clientInfo(ip, userAgent),
    );
  }
}
