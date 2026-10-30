import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices';
import { PlatformModule } from '../platform/platform.module';
import { BalanceService } from './balance.service';
import { BillingReadsService } from './billing-reads.service';
import { BillingLossCaseListener } from './providers/loss-case-listener.provider';
import { BillingOrganizationExitCheck } from './providers/organization-exit-check.provider';
import { ChargesService } from './charges.service';
import { DamageChargeService } from './damage-charge.service';
import { DamageChargesController } from './damage-charges.controller';
import { DamageChargesRepository } from './damage-charges.repository';
import { InvoicesController } from './invoices.controller';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PricingAdminController } from './pricing-admin.controller';
import { PricingController } from './pricing.controller';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';
import { SepayController } from './sepay.controller';
import { SepayWebhookGuard } from './sepay-webhook.guard';
import { SepayService } from './sepay.service';

// Billing (specs/billing/design.md). Foundation: the invoices, payments and pricing repositories,
// prices and quotes, term and day-plan invoices, the cancellation adjustment, late and damage charges,
// balances and counter payments; the plan catalogue, quotes, price and damage schedules, invoice,
// payment and balance endpoints, SePay sandbox payments and their expiry job, and the damage charge
// queue and decision (UC-48, D-081). Its exit-check provider (the reactivation check of `organizations`) is BillingOrganizationExitCheck.
@Module({
  imports: [PlatformModule, DevicesModule],
  controllers: [
    PricingController,
    PricingAdminController,
    InvoicesController,
    SepayController,
    DamageChargesController,
  ],
  providers: [
    InvoicesRepository,
    PaymentsRepository,
    InvoicesService,
    ChargesService,
    BillingLossCaseListener,
    BalanceService,
    PaymentsService,
    PricingRepository,
    PricingService,
    DamageChargesRepository,
    DamageChargeService,
    BillingReadsService,
    SepayService,
    SepayWebhookGuard,
    BillingOrganizationExitCheck,
  ],
  exports: [InvoicesService, ChargesService, BalanceService, PaymentsService, PricingService],
})
export class BillingModule {}
