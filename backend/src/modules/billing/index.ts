// Public surface of `billing`. Other modules import only from here.
export { BillingModule } from './billing.module';
export { BalanceService, type BalanceSummary, type VariantRevenue } from './balance.service';
export {
  ChargesService,
  type ChargedContract,
  type ChargedDevice,
  type DamagedInspection,
  type DamageResult,
  type EarlyEndQuote,
  type EndedContract,
  type EndedTerm,
  type FirstInvoiceContract,
  type LateContract,
} from './charges.service';
export {
  InvoicesService,
  type BillableContract,
  type BillableDayPlan,
  type BillableMonthlyContract,
  type BillableTerm,
} from './invoices.service';
export type { InvoiceWithLines, LineRow as InvoiceLineRow } from './invoices.repository';
export { ceilVnd, dayPlanFeeVnd, holdingFeeVnd, termFeeVnd, type EarlyEndCredit } from './money';
export {
  PAYMENT_CONFIRMED,
  PaymentsService,
  type CounterPaymentInput,
  type PaymentConfirmedEvent,
  type ReceivedPayment,
} from './payments.service';
export {
  PricingService,
  type Catalogue,
  type PriceSnapshot,
  type Quote,
  type QuoteInput,
  type RateTableRow,
} from './pricing.service';
export {
  CONTRACT_DIRECTORY,
  type ContractDirectory,
  type ContractLabel,
  type InvoiceBuyer,
} from './ports/contract-directory.port';
export {
  CREDIT_BASIS,
  type CreditBasis,
  type CreditContract,
  type CreditTerm,
  type CreditUnit,
} from './ports/credit-basis.port';
export {
  releaseCreditQuote,
  SERVICE_CREDIT_NOTICE,
  ServiceCreditService,
  type ServiceCreditNoticeEvent,
} from './service-credit.service';
