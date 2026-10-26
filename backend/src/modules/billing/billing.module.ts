import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { BalanceService } from './balance.service';
import { ChargesService } from './charges.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

// Billing (specs/billing/design.md). Foundation: the invoices, payments and pricing repositories,
// prices and quotes, term and day-plan invoices, the cancellation adjustment, balances and counter
// payments. SePay, the controllers and the exit-check and loss-case providers join with their tasks.
@Module({
  imports: [PlatformModule],
  providers: [
    InvoicesRepository,
    PaymentsRepository,
    InvoicesService,
    ChargesService,
    BalanceService,
    PaymentsService,
    PricingRepository,
    PricingService,
  ],
  exports: [InvoicesService, ChargesService, BalanceService, PaymentsService, PricingService],
})
export class BillingModule {}
