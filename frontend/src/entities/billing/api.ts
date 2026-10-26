import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
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

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
};

export const INVOICE_TONES: Record<InvoiceStatus, string> = {
  ISSUED: 'bg-blue-50 text-blue-800 border-blue-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-900 border-amber-200',
  PAID: 'bg-emerald-50 text-emerald-800 border-emerald-200',
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
