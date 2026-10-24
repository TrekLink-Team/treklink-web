import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RoleView } from './accounts.repository';
import { clientInfo } from './auth.controller';
import { ReplacePermissionsDto } from './dto/auth.dto';
import { CatalogPermission, RolePermissionsResult, RolesService } from './roles.service';

const canManageRoles = CheckPolicies((ability) => ability.can('manage', 'Role'));

// Roles (auth task 6.1, api-design 15 and 16). TrekLink Admin only (`role.manage`).
@Controller('roles')
@canManageRoles
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ResponseMessage('OK')
  list(): Promise<RoleView[]> {
    return this.roles.list();
  }

  @Put(':id/permissions')
  @ResponseMessage('Permissions updated')
  replacePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePermissionsDto,
    @CurrentCaller() caller: Caller,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<RolePermissionsResult> {
    return this.roles.replacePermissions(caller, id, dto.permissionKeys, clientInfo(ip, userAgent));
  }
}

// The permission catalog (api-design 18, D-057 rule 2), gated by `role.manage`.
@Controller('permissions')
@canManageRoles
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ResponseMessage('OK')
  catalog(): Promise<CatalogPermission[]> {
    return this.roles.catalog();
  }
}
