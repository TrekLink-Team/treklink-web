import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices';
import { PlatformModule } from '../platform/platform.module';
import { BalanceService } from './balance.service';
import { BillingReadsService } from './billing-reads.service';
import { ChargesService } from './charges.service';
import { DamageChargesRepository } from './damage-charges.repository';
import { InvoicesController } from './invoices.controller';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PricingController } from './pricing.controller';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

// Billing (specs/billing/design.md). Foundation: the invoices, payments and pricing repositories,
// prices and quotes, term and day-plan invoices, the cancellation adjustment, late and damage charges,
// balances and counter payments; the plan catalogue, quotes, invoice, payment and balance endpoints.
// SePay, the price and damage endpoints and the exit-check and loss-case providers join with their
// tasks.
@Module({
  imports: [PlatformModule, DevicesModule],
  controllers: [PricingController, InvoicesController],
  providers: [
    InvoicesRepository,
    PaymentsRepository,
    InvoicesService,
    ChargesService,
    BalanceService,
    PaymentsService,
    PricingRepository,
    PricingService,
    DamageChargesRepository,
    BillingReadsService,
  ],
  exports: [InvoicesService, ChargesService, BalanceService, PaymentsService, PricingService],
})
export class BillingModule {}
