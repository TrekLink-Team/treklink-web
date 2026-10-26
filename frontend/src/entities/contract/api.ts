import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// Rental contracts as rentals api-design 01 to 06 and 18 return them.
export type ContractStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'ACTIVE'
  | 'ENDING'
  | 'RETURN_DUE'
  | 'OVERDUE'
  | 'DEFAULTED'
  | 'RETURNED'
  | 'CLOSED';

export type PlanType = 'MONTHLY' | 'DAY';

export interface ContractTerm {
  seq: number;
  startsAt: string;
  endsAt: string;
}

export interface Contract {
  id: string;
  code: string;
  organization: { id: string; code: string; legalName: string } | null;
  planType: PlanType;
  dayPlanDays: number | null;
  hardwareVariant: { id: string; code: string | null };
  quantity: number;
  requestedStartDate: string;
  monthlyUnitPriceVnd: number;
  dayPremium: number | null;
  holdingFeeRatio: number;
  status: ContractStatus;
  statusChangedAt: string;
  handedOverAt: string | null;
  currentTerm: ContractTerm | null;
  endsAt: string | null;
  noticeGivenAt: string | null;
  returnDueAt: string | null;
  version: number;
  reservationExpiresAt?: string | null;
}

export interface ContractDevice {
  deviceId: string;
  assetTag: string | null;
  handedOverAt: string | null;
  checkedInAt: string | null;
  lostAt: string | null;
  holder: { name: string; phone: string | null; emergencyContact: string | null } | null;
}

export interface ContractDetail extends Contract {
  terms: (ContractTerm & { status: 'OPEN' | 'CLOSED' })[];
  devices: ContractDevice[];
  balance: { dueNowVnd: number; dueLaterVnd: number };
}

export interface ContractTransition {
  fromStatus: ContractStatus | null;
  toStatus: ContractStatus;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface ContractFilters {
  status?: ContractStatus;
  planType?: PlanType;
  pageNumber?: number;
}

export interface ContractRequest {
  planType: PlanType;
  dayPlanDays?: number;
  hardwareVariantId: string;
  quantity: number;
  requestedStartDate: string;
}

export type Approved = Contract & { devices: ContractDevice[]; reservationExpiresAt: string };

export const queryString = (params: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
};

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

// Query keys of screens 5.1 to 5.3; a mutation invalidates ['contracts'] and ['contract', id].
export const contractKeys = {
  all: ['contracts'] as const,
  list: (scope: 'o' | 't', filters: ContractFilters) => ['contracts', scope, filters] as const,
  detail: (id: string) => ['contract', id] as const,
  balance: (id: string) => ['contract-balance', id] as const,
  transitions: (id: string) => ['contract-transitions', id] as const,
};

export const fetchContracts = (filters: ContractFilters) =>
  apiClient<Page<Contract>>(`/contracts${queryString({ ...filters })}`);

export const fetchContract = (id: string) => apiClient<ContractDetail>(`/contracts/${id}`);

export const fetchTransitions = (id: string) =>
  apiClient<ContractTransition[]>(`/contracts/${id}/transitions`);

// rentals api-design 01.
export const requestContract = (request: ContractRequest) => post<Contract>('/contracts', request);

// rentals api-design 04, 05, 06.
export const approveContract = (id: string, handoverAt: string, expectedVersion: number) =>
  post<Approved>(`/contracts/${id}/approve`, { handoverAt, expectedVersion });

export const rejectContract = (id: string, reason: string, expectedVersion: number) =>
  post<Contract>(`/contracts/${id}/reject`, { reason, expectedVersion });

export const cancelContract = (id: string, reason: string, expectedVersion: number) =>
  post<Contract & { retainedVnd: number }>(`/contracts/${id}/cancel`, { reason, expectedVersion });

export const useContracts = (scope: 'o' | 't', filters: ContractFilters) =>
  useQuery({
    queryKey: contractKeys.list(scope, filters),
    queryFn: () => fetchContracts(filters),
  });

export const useContract = (id: string) =>
  useQuery({ queryKey: contractKeys.detail(id), queryFn: () => fetchContract(id) });

export const useTransitions = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: contractKeys.transitions(id),
    queryFn: () => fetchTransitions(id),
    enabled,
  });

// Labels of the lifecycle palette (chapter 06 §8.3): status as text, never colour alone.
export const STATUS_LABELS: Record<ContractStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  ACTIVE: 'Active',
  ENDING: 'Ending',
  RETURN_DUE: 'Return due',
  OVERDUE: 'Overdue',
  DEFAULTED: 'Defaulted',
  RETURNED: 'Returned',
  CLOSED: 'Closed',
};

export const STATUS_TONES: Record<ContractStatus, string> = {
  REQUESTED: 'bg-blue-50 text-blue-800 border-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-slate-100 text-slate-700 border-slate-300',
  CANCELLED: 'bg-slate-100 text-slate-700 border-slate-300',
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  ENDING: 'bg-amber-50 text-amber-900 border-amber-200',
  RETURN_DUE: 'bg-amber-50 text-amber-900 border-amber-200',
  OVERDUE: 'bg-red-50 text-red-800 border-red-200',
  DEFAULTED: 'bg-red-50 text-red-800 border-red-200',
  RETURNED: 'bg-slate-100 text-slate-700 border-slate-300',
  CLOSED: 'bg-slate-100 text-slate-700 border-slate-300',
};

export const planLabel = (contract: Pick<Contract, 'planType' | 'dayPlanDays'>): string =>
  contract.planType === 'DAY' ? `Day plan, ${contract.dayPlanDays} days` : 'Monthly';

// The next date of a list row (screen 5.2): the current term's end, else the return due time, else
// the requested start date.
export const nextDateOf = (contract: Contract): { iso?: string; day?: string } =>
  contract.currentTerm
    ? { iso: contract.currentTerm.endsAt }
    : contract.returnDueAt
      ? { iso: contract.returnDueAt }
      : { day: contract.requestedStartDate };
