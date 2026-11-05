import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import type { Variant } from '../device/api';

// A variant as the Admin list reads it (devices api-design 01 with includeInactive): the registered
// unit count decides which fields stay fixed and whether Delete is offered (REQ-STA-02); the version
// is the optimistic lock of an edit (api-design 03, REQ-ERR-19).
export interface AdminVariant extends Variant {
  deviceCount: number;
  version: number;
}

export interface VariantInput {
  name: string;
  hasGps: boolean;
  hasMotionSensor: boolean;
  mqttCapable: boolean;
  firmwareBaseline: string;
  remainingValueSchedule: { fromMonths: number; valueVnd: number }[];
  serviceIntervalDays: number | null;
  serviceChecklist: string[];
  imageUrl: string | null;
  specSheet: Record<string, string>;
}

// Screen 4.1: `['hardware-variants', { includeInactive: true }]`. Every write invalidates the
// `['hardware-variants']` prefix, so the reads of the other screens refetch too.
export const variantKeys = {
  all: ['hardware-variants'] as const,
  admin: ['hardware-variants', { includeInactive: true }] as const,
};

export const useAdminVariants = () =>
  useQuery({
    queryKey: variantKeys.admin,
    queryFn: () => apiClient<AdminVariant[]>('/hardware-variants?includeInactive=true'),
  });

export const createVariant = (input: VariantInput & { code: string }) =>
  apiClient<AdminVariant>('/hardware-variants', { method: 'POST', body: JSON.stringify(input) });

export const updateVariant = (
  id: string,
  input: Partial<VariantInput> & { isActive?: boolean; expectedVersion: number },
) =>
  apiClient<AdminVariant>(`/hardware-variants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteVariant = (id: string) =>
  apiClient<null>(`/hardware-variants/${id}`, { method: 'DELETE' });
