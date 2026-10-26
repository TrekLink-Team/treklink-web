import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { BalanceService } from './balance.service';
import { ChargesService } from './charges.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

// Billing (specs/billing/design.md). Foundation: the invoices and payments repositories, term and
// day-plan invoices, the cancellation adjustment, balances and counter payments. Pricing, SePay, the
// controllers and the exit-check and loss-case providers join with their tasks.
@Module({
  imports: [PlatformModule],
  providers: [
    InvoicesRepository,
    PaymentsRepository,
    InvoicesService,
    ChargesService,
    BalanceService,
    PaymentsService,
  ],
  exports: [InvoicesService, ChargesService, BalanceService, PaymentsService],
})
export class BillingModule {}
