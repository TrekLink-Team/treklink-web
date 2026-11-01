import { Module } from '@nestjs/common';
import { DemoAccountsController } from './demo-accounts.controller';
import { DemoAccountsService } from './demo-accounts.service';

// The sandbox test accounts list (specs/demo/design.md §8, D-089). AppModule imports it only when
// DEMO_TEST_ACCOUNTS_ENABLED is true, independently of DemoModule. It imports no other module, touches no
// database, loads no seed file and offers none of the control panel's actions, so the reset stays behind
// DemoModule's guards.
@Module({
  controllers: [DemoAccountsController],
  providers: [DemoAccountsService],
})
export class DemoAccountsModule {}
