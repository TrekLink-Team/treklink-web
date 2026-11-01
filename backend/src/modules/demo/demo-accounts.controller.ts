import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DemoAccountsService } from './demo-accounts.service';

// The sandbox test accounts read (specs/demo api-design 05). Public on purpose (D-088 amendment of
// 2026-11-01, D-089): testers sign in as any role without asking for a password. Routed only while
// DEMO_TEST_ACCOUNTS_ENABLED loads DemoAccountsModule; never cached.
@Controller('demo')
export class DemoAccountsController {
  constructor(private readonly testAccounts: DemoAccountsService) {}

  @Get('accounts')
  @Public()
  @Header('Cache-Control', 'no-store')
  @ResponseMessage('OK')
  accounts() {
    return this.testAccounts.list();
  }
}
