import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { INVOICE_STATUS, TONE_CLASSES } from '../../shared/ui/status';
import { queryString, type Page, type PlanType } from '../contract/api';

// Plans, quotes, invoices, payments and balances as billing api-design 01, 02, 08 to 10, 13 and 14
// return them.
export interface PlanVariant {
  id: string;
  code: string;
  name: string;
  monthlyPriceVnd: number;
  dayPriceVnd: number;
}

export interface Plans {
  minOrderQuantity: number;
  holdingFeeRatio: number;
  dayPlanLengths: number[];
  dayPremium: number;
  variants: PlanVariant[];
  sandbox: boolean;
}

export interface QuoteRequest {
  planType: PlanType;
  dayPlanDays?: number;
  hardwareVariantId: string;
  quantity: number;
}

export interface Quote {
  planType: PlanType;
  quantity: number;
  firstPaymentVnd: number;
  formula: string;
  termFeeVnd?: number;
  unitPerDayVnd?: number;
  days?: number;
  totalVnd?: number;
}

export type InvoiceStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID';

export interface Invoice {
  id: string;
  number: string;
  organization: { id: string; code: string | null };
  contract: { id: string; code: string | null };
  kind: string;
  term: { seq: number } | null;
  status: InvoiceStatus;
  totalVnd: number;
  paidVnd: number;
  issuedAt: string;
}

export interface InvoiceLine {
  seq: number;
  type: string;
  description: string;
  quantity: number;
  unitVnd: number;
  amountVnd: number;
  dueAt: string;
  paidVnd: number;
}

export interface Payment {
  id: string;
  reference: string;
  invoiceId: string;
  contractId: string;
  amountVnd: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'SEPAY';
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'FAILED';
  isSandbox: boolean;
  expiresAt: string | null;
  confirmedAt: string | null;
}

export interface InvoiceDetail extends Invoice {
  lines: InvoiceLine[];
  payments: Payment[];
}

export interface Balance {
  contractId: string;
  dueNowVnd: number;
  dueLaterVnd: number;
  paidVnd: number;
  pendingDamageCharges: unknown[];
  settled: boolean;
}

export interface InvoiceFilters {
  contractId?: string;
  status?: InvoiceStatus;
  overdue?: boolean;
  pageNumber?: number;
  pageSize?: number;
}

export interface PaymentFilters {
  contractId?: string;
  status?: Payment['status'];
  pageNumber?: number;
}

export interface CounterPayment {
  method: 'CASH' | 'BANK_TRANSFER';
  amountVnd: number;
  reference: string;
}

export const billingKeys = {
  plans: ['plans'] as const,
  quote: (request: QuoteRequest) =>
    [
      'quote',
      request.planType,
      request.dayPlanDays,
      request.hardwareVariantId,
      request.quantity,
    ] as const,
  invoices: (scope: 'o' | 't', filters: InvoiceFilters) => ['invoices', scope, filters] as const,
  invoice: (id: string) => ['invoice', id] as const,
  payments: (filters: PaymentFilters) => ['payments', filters] as const,
  balance: (contractId: string) => ['contract-balance', contractId] as const,
};

export const fetchPlans = () => apiClient<Plans>('/plans');

export const fetchQuote = (request: QuoteRequest) =>
  apiClient<Quote>('/quotes', { method: 'POST', body: JSON.stringify(request) });

export interface VietQr {
  imageUrl: string;
  bankAccount: string;
  content: string;
}

export type SepayPayment = Payment & { vietQr: VietQr | null };

// billing api-design 11: a PENDING sandbox payment with its QR (409 PAYMENT_PENDING, NOTHING_DUE).
export const requestSepayPayment = (invoiceId: string) =>
  apiClient<SepayPayment>(`/invoices/${invoiceId}/payments/sepay`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

// billing api-design 15, polled every few seconds while the payment is PENDING.
export const usePayment = (id: string) =>
  useQuery({
    queryKey: ['payment', id] as const,
    queryFn: () => apiClient<SepayPayment>(`/payments/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 3000 : false),
  });

export const recordCounterPayment = (invoiceId: string, payment: CounterPayment) =>
  apiClient<Payment>(`/invoices/${invoiceId}/payments/counter`, {
    method: 'POST',
    body: JSON.stringify(payment),
  });

export const usePlans = () =>
  useQuery({ queryKey: billingKeys.plans, queryFn: fetchPlans, staleTime: 60_000 });

export const useInvoices = (scope: 'o' | 't', filters: InvoiceFilters) =>
  useQuery({
    queryKey: billingKeys.invoices(scope, filters),
    queryFn: () => apiClient<Page<Invoice>>(`/invoices${queryString({ ...filters })}`),
  });

export const useInvoice = (id: string | null) =>
  useQuery({
    queryKey: billingKeys.invoice(id ?? ''),
    queryFn: () => apiClient<InvoiceDetail>(`/invoices/${id}`),
    enabled: id !== null,
  });

export const usePayments = (filters: PaymentFilters) =>
  useQuery({
    queryKey: billingKeys.payments(filters),
    queryFn: () => apiClient<Page<Payment>>(`/payments${queryString({ ...filters })}`),
  });

export const useBalance = (contractId: string, enabled: boolean) =>
  useQuery({
    queryKey: billingKeys.balance(contractId),
    queryFn: () => apiClient<Balance>(`/contracts/${contractId}/balance`),
    enabled,
  });

// Price and damage schedules (billing api-design 03 to 07), TrekLink Admin.
export interface PriceRow {
  id: string;
  hardwareVariantId: string;
  monthlyPriceVnd: number;
  effectiveFrom: string;
  createdAt: string;
  createdBy: string | null;
  // Against the whole schedule, from the server (billing api-design 03).
  state: 'CURRENT' | 'UPCOMING' | 'PAST';
}

export interface DamageRate {
  id: string;
  code: string;
  label: string;
  hardwareVariantId: string | null;
  amountVnd: number;
  isActive: boolean;
}

export const usePriceHistory = (pageNumber: number) =>
  useQuery({
    queryKey: ['price-schedules', pageNumber] as const,
    queryFn: () => apiClient<Page<PriceRow>>(`/price-schedules${queryString({ pageNumber })}`),
  });

export const useDamageRates = () =>
  useQuery({
    queryKey: ['damage-rates'] as const,
    queryFn: () => apiClient<DamageRate[]>('/damage-rates'),
  });

export const schedulePrice = (input: {
  hardwareVariantId: string;
  monthlyPriceVnd: number;
  effectiveFrom: string;
}) => apiClient<PriceRow>('/price-schedules', { method: 'POST', body: JSON.stringify(input) });

export const createDamageRate = (input: {
  code: string;
  label: string;
  hardwareVariantId: string | null;
  amountVnd: number;
}) => apiClient<DamageRate>('/damage-rates', { method: 'POST', body: JSON.stringify(input) });

export const updateDamageRate = (
  id: string,
  patch: { label?: string; amountVnd?: number; isActive?: boolean },
) => apiClient<DamageRate>(`/damage-rates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
};

// Badge classes per status, from the invoice palette of the TrekLink System (shared/ui/status.ts).
export const INVOICE_TONES: Record<InvoiceStatus, string> = {
  ISSUED: TONE_CLASSES[INVOICE_STATUS.ISSUED.tone],
  PARTIALLY_PAID: TONE_CLASSES[INVOICE_STATUS.PARTIALLY_PAID.tone],
  PAID: TONE_CLASSES[INVOICE_STATUS.PAID.tone],
};

// Line status of screen 6.1, derived on the client; the first matching rule wins.
export const lineStatus = (line: InvoiceLine, now: Date = new Date()): string => {
  if (line.paidVnd >= line.amountVnd) return 'Paid';
  const due = new Date(line.dueAt);
  const sameDay = due.toDateString() === now.toDateString();
  if (!sameDay && due < now) return 'Overdue';
  if (sameDay) return 'Due now';
  return 'Due later';
};
