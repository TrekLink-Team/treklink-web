import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { UpdateOrganizationDto } from './dto/profile.dto';
import { OrganizationProfileService } from './organization-profile.service';
import { MemberView, OrganizationsService } from './organizations.service';

export class MembersQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeDeactivated?: boolean;
}

// The first organizations endpoints, built by LongLP for the counter handover of screen 5.4: the head
// of api-design 03 (the channel key version) and api-design 12 (task 2.5, read-only part, the signer).
// Members read their own organization (`organization.read.own`, `member.read.own`), TrekLink Staff
// any (`organization.read`, `member.read`).
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly profile: OrganizationProfileService,
  ) {}

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'Organization'))
  @ResponseMessage('OK')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.profile.detail(id, caller);
  }

  // api-design 04: a Manager edits the contact details of its own organization, an Admin any, and
  // only an Admin the legal name.
  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'Organization'))
  @ResponseMessage('Saved.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOrganizationDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.profile.update(id, body, caller);
  }

  @Get(':id/members')
  @CheckPolicies((ability) => ability.can('read', 'Member'))
  @ResponseMessage('OK')
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MembersQueryDto,
    @CurrentCaller() caller: Caller,
  ): Promise<MemberView[]> {
    return this.organizations.membersOf(id, query.includeDeactivated === true, caller);
  }
}
