import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  Caller,
  CheckPolicies,
  CurrentCaller,
  Public,
} from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  ApproveOrganizationDto,
  OrganizationQueryDto,
  RegisterOrganizationDto,
  RejectOrganizationDto,
  VerifyOrganizationDto,
} from './dto/onboarding.dto';
import { OrganizationOnboardingService } from './organization-onboarding.service';

// Organization onboarding (api-design 01, 02, 05 to 07): public registration, the Staff and Admin
// queue, counter verification (`organization.verify`, Staff and Admin) and the Admin decision
// (`organization.decide`). MSG16 carries the reason, so the page builds it from the result.
@Controller('organizations')
export class OrganizationOnboardingController {
  constructor(private readonly onboarding: OrganizationOnboardingService) {}

  @Post('register')
  @Public()
  @ResponseMessage(
    'Registration received. Visit the TrekLink counter or call us to verify your organization.',
  )
  async register(@Body() dto: RegisterOrganizationDto) {
    const organization = await this.onboarding.register({
      ...dto,
      legalName: dto.legalName.trim(),
      address: dto.address.trim(),
      managerFullName: dto.managerFullName.trim(),
      managerEmail: dto.managerEmail.trim().toLowerCase(),
    });
    return {
      organizationId: organization.id,
      code: organization.code,
      status: organization.status,
    };
  }

  @Get()
  @CheckPolicies((ability) => ability.can('verify', 'Organization'))
  @ResponseMessage('OK')
  page(@Query() query: OrganizationQueryDto) {
    return this.onboarding.page(query);
  }

  @Post(':id/verification')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('verify', 'Organization'))
  @ResponseMessage('Saved.')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyOrganizationDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.onboarding.verify(
      id,
      { ...dto, masterContractRef: dto.masterContractRef.trim() },
      caller,
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('decide', 'Organization'))
  @ResponseMessage('Your organization is approved. You can now invite members and request devices.')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveOrganizationDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.onboarding.approve(id, dto.expectedVersion, caller);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('decide', 'Organization'))
  @ResponseMessage('Organization rejected')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrganizationDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.onboarding.reject(id, dto.reason.trim(), dto.expectedVersion, caller);
  }
}
