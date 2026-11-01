import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { BrokerHookSecretGuard } from './broker-hook-secret.guard';
import { BrokerAuthService, BrokerCredentialKind } from './broker-hooks.service';
import { BrokerAclCheckDto, BrokerUserCheckDto } from './dto/broker-hooks.dto';

// The mosquitto-go-auth HTTP backend's hooks (task 3.1, api-design 01 and 02). No user token: the
// caller is the broker, proven by `X-Broker-Secret` (BrokerHookSecretGuard). Every answer is the
// D-002 envelope; go-auth's status mode allows on 200 and denies on 401 or 403.
@Controller('internal/mqtt')
@Public()
@UseGuards(BrokerHookSecretGuard)
export class BrokerAuthController {
  constructor(private readonly brokerAuth: BrokerAuthService) {}

  @Post('user')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('OK')
  user(@Body() dto: BrokerUserCheckDto): Promise<{ allowed: true; kind: BrokerCredentialKind }> {
    return this.brokerAuth.checkUser(dto);
  }

  @Post('acl')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('OK')
  acl(@Body() dto: BrokerAclCheckDto): { allowed: true } {
    return this.brokerAuth.checkAcl(dto);
  }
}
