import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { CONTRACT_STATUS, TONE_CLASSES, type DeviceStatus } from '../../shared/ui/status';
import type { NextStep } from '../device/api';
import { formatDate, formatDay } from '../../shared/lib/format';

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
  // The counter appointment set at approval (rentals api-design 03 and 04).
  handoverAppointmentAt?: string | null;
  // When an unpaid request hold expires (rentals api-design 01 to 03, D-092); null before D-092.
  holdExpiresAt?: string | null;
}

// rentals api-design 01 since D-092 rule 1: the request holds its units and names the deposit.
export interface RequestedContract extends Contract {
  quote: { firstPaymentVnd: number; termFeeVnd?: number; totalVnd?: number };
  holdExpiresAt: string;
  heldDevices: number;
}

export interface ContractDevice {
  deviceId: string;
  assetTag: string | null;
  handedOverAt: string | null;
  checkedInAt: string | null;
  lostAt: string | null;
  holder: { name: string; phone: string | null; emergencyContact: string | null } | null;
  // The reset and inspection of this row's return (rentals api-design 03); absent outside the detail.
  resetAt?: string | null;
  inspection?: { result: InspectionResult; at: string } | null;
  // The channel key version the unit carries for this organization (api-design 03); null when none.
  provisionedKeyVersion?: number | null;
  // TrekLink callers, checked-in rows: the unit's state now and its next step back to AVAILABLE,
  // the step only on the row of its latest return (api-design 03, REQ-EVT-18, D-092 rule 4).
  afterReturn?: { status: DeviceStatus; nextStep: NextStep | null } | null;
}

// rentals api-design 20 (REQ-EVT-17, D-092 rule 3): what still blocks the close, for Staff.
export type CloseBlocker =
  | { code: 'NOT_RETURNED'; message: string; waitsFor: string | null }
  | {
      code: 'DEVICE_OUT';
      message: string;
      deviceId: string;
      assetTag: string;
      lossCase: { id: string; code: string; state: string } | null;
    }
  | { code: 'BALANCE_OUTSTANDING'; message: string; amountVnd: number }
  | {
      code: 'DAMAGE_PENDING';
      message: string;
      chargeId: string;
      deviceId: string;
      assetTag: string;
      amountVnd: number;
    }
  | { code: 'OPEN_INCIDENTS'; message: string; incidents: { id: string; code: string }[] };

export interface CloseCheck {
  contractId: string;
  status: ContractStatus;
  version: number;
  canClose: boolean;
  blockers: CloseBlocker[];
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
  pageSize?: number;
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
  // Under the detail key, so every invalidation of the detail refetches it too.
  closeCheck: (id: string) => ['contract', id, 'close-check'] as const,
  balance: (id: string) => ['contract-balance', id] as const,
  transitions: (id: string) => ['contract-transitions', id] as const,
};

export const fetchContracts = (filters: ContractFilters) =>
  apiClient<Page<Contract>>(`/contracts${queryString({ ...filters })}`);

export const fetchContract = (id: string) => apiClient<ContractDetail>(`/contracts/${id}`);

export const fetchTransitions = (id: string) =>
  apiClient<ContractTransition[]>(`/contracts/${id}/transitions`);

// rentals api-design 01.
export const requestContract = (request: ContractRequest) =>
  post<RequestedContract>('/contracts', request);

// rentals api-design 04, 05, 06.
export const approveContract = (id: string, handoverAt: string, expectedVersion: number) =>
  post<Approved>(`/contracts/${id}/approve`, { handoverAt, expectedVersion });

export const rejectContract = (id: string, reason: string, expectedVersion: number) =>
  post<Contract>(`/contracts/${id}/reject`, { reason, expectedVersion });

export const cancelContract = (id: string, reason: string, expectedVersion: number) =>
  post<Contract & { retainedVnd: number }>(`/contracts/${id}/cancel`, { reason, expectedVersion });

// rentals api-design 12: notice on an ACTIVE monthly contract (MSG18).
export const giveNotice = (id: string, expectedVersion: number) =>
  post<Contract & { dueAtEndVnd: number }>(`/contracts/${id}/notice`, { expectedVersion });

export interface HolderInput {
  name: string | null;
  phone?: string | null;
  emergencyContact?: string | null;
}

// rentals api-design 13: set or, with a null name, clear a device's holder label (MSG03).
export const setHolder = (id: string, deviceId: string, holder: HolderInput) =>
  apiClient<ContractDevice>(`/contracts/${id}/devices/${deviceId}/holder`, {
    method: 'PUT',
    body: JSON.stringify(holder),
  });

export interface Swapped {
  released: { deviceId: string; assetTag: string | null; status: string };
  reserved: { id: string; assetTag: string; status: string };
}

export interface Provisioned {
  deviceId: string;
  assetTag: string;
  status: string;
  keyVersion: number;
  keyOrganizationId: string;
  provisionedAt: string;
}

// rentals api-design 19: the unit with its record cleared, and the contract version to send next.
export interface ProvisioningUndone {
  deviceId: string;
  assetTag: string;
  status: string;
  keyVersion: null;
  keyOrganizationId: null;
  provisionedAt: null;
  contractVersion: number;
}

export interface DeviceCheck {
  deviceId: string;
  batteryPct: number;
  gpsFixOk: boolean;
}

export interface HandoverInput {
  signedByMemberId: string;
  identityChecked: string;
  signaturePng: string;
  deviceChecks: DeviceCheck[];
  acknowledgeLowBattery?: boolean;
  expectedVersion: number;
}

export interface HandoverNote {
  pdfBase64: string | null;
  sha256: string | null;
  integrity?: 'OK' | 'MISMATCH' | 'MISSING';
}

// rentals api-design 07 to 11, the counter handover of screen 5.4.
export const swapDevice = (id: string, deviceId: string, reason: string) =>
  post<Swapped>(`/contracts/${id}/devices/${deviceId}/swap`, { reason });

export const recordProvisioning = (id: string, deviceId: string, keyVersion: number) =>
  post<Provisioned>(`/contracts/${id}/devices/${deviceId}/provisioning`, { keyVersion });

// Undoes a provisioning recorded on the wrong unit, before the handover (api-design 19).
export const undoProvisioning = (id: string, deviceId: string, expectedVersion: number) =>
  post<ProvisioningUndone>(`/contracts/${id}/devices/${deviceId}/provisioning/undo`, {
    expectedVersion,
  });

// The readings the counter holds go with the preview, so the note prints each unit's battery and GPS
// fix (api-design 08 `checks`); nothing is stored until the handover.
export const fetchHandoverPreview = (id: string, checks: DeviceCheck[] = []) =>
  apiClient<HandoverNote>(
    `/contracts/${id}/handover-note/preview${
      checks.length > 0 ? `?${new URLSearchParams({ checks: JSON.stringify(checks) })}` : ''
    }`,
  );

export const completeHandover = (id: string, input: HandoverInput) =>
  post<Contract & { devicesHandedOver: number }>(`/contracts/${id}/handover`, input);

// MF-05 at the counter (rentals api-design 14, 16, 17; devices api-design 10).
export interface CheckInResult {
  checkedIn: string[];
  returned: number;
  total: number;
  contractStatus: ContractStatus;
  lateFeeVnd: number;
}

export type InspectionResult = 'PASSED' | 'DAMAGED' | 'FAILED';

export interface InspectionOutcome {
  inspection: { id: string; result: InspectionResult; damageCodes: string[]; createdAt: string };
  device: { id: string; assetTag: string; status: string };
  damageCharge: { id: string; amountVnd: number; status: string } | null;
}

export const checkInDevices = (id: string, assetTags: string[]) =>
  post<CheckInResult>(`/contracts/${id}/check-ins`, { assetTags });

export const resetDevice = (deviceId: string) =>
  post<{ id: string; status: string }>(`/devices/${deviceId}/reset`, {
    keyRemoved: true,
    nodeDbCleared: true,
    ownerCleared: true,
  });

export const inspectDevice = (
  id: string,
  deviceId: string,
  input: { result: InspectionResult; damageCodes: string[]; note?: string },
) => post<InspectionOutcome>(`/contracts/${id}/devices/${deviceId}/inspection`, input);

export interface Replaced {
  replacedDeviceId: string;
  replacementDeviceId: string;
  contractDeviceId: string;
  replacesId: string;
  noteSha256: string;
}

// rentals api-design 15: a faulty or missing unit on a running contract is replaced at the counter.
export const replaceDevice = (
  id: string,
  deviceId: string,
  input: {
    replacementDeviceId: string;
    keyVersion: number;
    signatureImage: string;
    faultyPresent: boolean;
  },
) => post<Replaced>(`/contracts/${id}/devices/${deviceId}/replacement`, input);

// devices api-design 06: the AVAILABLE unit of a variant with exactly this asset tag, or null.
export const findAvailableUnit = async (
  assetTag: string,
  hardwareVariantId: string,
): Promise<{ id: string; assetTag: string } | null> => {
  const page = await apiClient<{ items: { id: string; assetTag: string }[] }>(
    `/devices${queryString({ q: assetTag, status: 'AVAILABLE', hardwareVariantId, pageSize: 20 })}`,
  );
  return page.items.find((unit) => unit.assetTag.toUpperCase() === assetTag) ?? null;
};

export const fetchCloseCheck = (id: string) =>
  apiClient<CloseCheck>(`/contracts/${id}/close-check`);

// Refetched when the window regains focus: a loss settled or an invoice paid in another window must
// show the Close action here (the missing close button of the 2026-11-01 demo).
export const useCloseCheck = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: contractKeys.closeCheck(id),
    queryFn: () => fetchCloseCheck(id),
    enabled,
    refetchOnWindowFocus: true,
  });

export const closeContract = (id: string, expectedVersion: number) =>
  post<Contract & { closedAt: string }>(`/contracts/${id}/close`, { expectedVersion });

export const fetchHandoverNote = (id: string) =>
  apiClient<HandoverNote>(`/contracts/${id}/handover-note`);

// Opens a base64 PDF as a download without keeping it anywhere after the click.
export const downloadPdf = (pdfBase64: string, fileName: string) => {
  const bytes = Uint8Array.from(atob(pdfBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export interface Availability {
  hardwareVariantId: string;
  code: string;
  available: number;
}

// devices api-design 24: AVAILABLE units per variant. Since D-092 the request decides and holds the
// units; the count may change between the read and the request.
export const useAvailability = (hardwareVariantId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['availability', hardwareVariantId] as const,
    queryFn: () =>
      apiClient<Availability[]>(`/devices/availability${queryString({ hardwareVariantId })}`),
    enabled,
  });

export const AVAILABILITY_REFRESH_MS = 30_000;

// devices api-design 24 for every active variant, for the request form (screen 5.1, D-092 rule 1):
// refreshed every 30 s and on window focus, so the count a Manager reads stays close to the stock.
export const useAllAvailability = () =>
  useQuery({
    queryKey: ['availability', 'all'] as const,
    queryFn: () => apiClient<Availability[]>('/devices/availability'),
    refetchInterval: AVAILABILITY_REFRESH_MS,
    refetchOnWindowFocus: true,
  });

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

// Badge classes per status, from the contract palette of the TrekLink System (shared/ui/status.ts).
export const STATUS_TONES: Record<ContractStatus, string> = Object.fromEntries(
  Object.entries(CONTRACT_STATUS).map(([status, entry]) => [status, TONE_CLASSES[entry.tone]]),
) as Record<ContractStatus, string>;

export const planLabel = (contract: Pick<Contract, 'planType' | 'dayPlanDays'>): string =>
  contract.planType === 'DAY' ? `Day plan, ${contract.dayPlanDays} days` : 'Monthly';

const ENDED: readonly ContractStatus[] = ['REJECTED', 'CANCELLED', 'RETURNED', 'CLOSED'];

// The next date of a list row (screen 5.2): the current term's end, else the return due time, else
// the requested start date; none once the contract has ended.
export const nextDateOf = (contract: Contract): { iso?: string; day?: string } | null =>
  ENDED.includes(contract.status)
    ? null
    : contract.currentTerm
      ? { iso: contract.currentTerm.endsAt }
      : contract.returnDueAt
        ? { iso: contract.returnDueAt }
        : { day: contract.requestedStartDate };

// The next date as a list shows it, or empty when there is none.
export const formatNextDate = (contract: Contract): string => {
  const next = nextDateOf(contract);
  if (!next) return '';
  return next.iso ? formatDate(next.iso) : formatDay(next.day as string);
};
