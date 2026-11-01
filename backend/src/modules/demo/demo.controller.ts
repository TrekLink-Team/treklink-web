import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Authenticated, CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DemoScenariosService } from './demo-scenarios.service';
import { SEEDED_ROLES, SeededRole } from './demo-scenarios';

export class SwitchRoleDto {
  @IsIn(SEEDED_ROLES)
  role!: SeededRole;
}

const client = (ip: string | undefined, userAgent: string | undefined) => ({
  ip: ip ?? null,
  userAgent: userAgent ?? null,
});

// The demo control panel (specs/demo api-design 01 to 04, D-088). Loaded only when DEMO_CONTROLS_ENABLED
// is true; the POST routes pass DemoGuardService first. Token and policy are checked by the global guards.
// The public test accounts read (api-design 05) is DemoAccountsController, under its own flag (D-089).
@Controller('demo')
export class DemoController {
  constructor(private readonly scenarios: DemoScenariosService) {}

  @Get('status')
  @Authenticated()
  @ResponseMessage('OK')
  status() {
    return this.scenarios.status();
  }

  @Get('scenarios')
  @CheckPolicies((ability) => ability.can('stage', 'Demo'))
  @ResponseMessage('OK')
  list() {
    return this.scenarios.list();
  }

  @Post('scenarios/:id/stage')
  @HttpCode(200)
  @CheckPolicies((ability) => ability.can('stage', 'Demo'))
  @ResponseMessage('Scenario staged')
  stage(
    @Param('id') id: string,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.scenarios.stage(id, client(ip, userAgent));
  }

  @Post('switch-role')
  @HttpCode(200)
  @CheckPolicies((ability) => ability.can('switchRole', 'Demo'))
  @ResponseMessage('Signed in')
  switchRole(
    @Body() dto: SwitchRoleDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.scenarios.switchRole(dto.role, client(ip, userAgent));
  }
}
