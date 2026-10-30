import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ChangeMemberRoleDto, DeactivateMemberDto, InviteMemberDto } from './dto/members.dto';
import { MembersService } from './members.service';
import { MemberView } from './organizations.service';

// Member administration of the Org Manager (api-design 13 to 15, `member.manage.own`); the list is
// api-design 12 on `OrganizationsController`. The service answers 404 for another organization.
@Controller('organizations/:id/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Post()
  @CheckPolicies((ability) => ability.can('manage', 'Member'))
  @ResponseMessage('Invitation sent')
  invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteMemberDto,
    @CurrentCaller() caller: Caller,
  ): Promise<MemberView> {
    return this.members.invite(
      id,
      {
        ...dto,
        email: dto.email.trim().toLowerCase(),
        fullName: dto.fullName.trim(),
      },
      caller,
    );
  }

  @Patch(':memberId')
  @CheckPolicies((ability) => ability.can('manage', 'Member'))
  @ResponseMessage('Saved.')
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: ChangeMemberRoleDto,
    @CurrentCaller() caller: Caller,
  ): Promise<MemberView> {
    return this.members.changeRole(id, memberId, dto.role, caller);
  }

  @Post(':memberId/deactivate')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('manage', 'Member'))
  @ResponseMessage('Member deactivated')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: DeactivateMemberDto,
    @CurrentCaller() caller: Caller,
  ): Promise<MemberView> {
    return this.members.deactivate(id, memberId, dto.reason?.trim() || undefined, caller);
  }
}
