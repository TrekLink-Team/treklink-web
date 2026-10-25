import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { ChargesService } from './charges.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';

// Billing (specs/billing/design.md). Foundation: the invoices repository, term and day-plan
// invoices, the cancellation adjustment and balances. Pricing, payments, the controllers and the
// exit-check and loss-case providers join with their tasks.
@Module({
  providers: [InvoicesRepository, InvoicesService, ChargesService, BalanceService],
  exports: [InvoicesService, ChargesService, BalanceService],
})
export class BillingModule {}
