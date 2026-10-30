import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// An organization API key as organizations api-design 20 to 22 return it. Only the prefix is ever
// shown again: the platform stores the SHA-256 hash, never the key (REQ-UBI-03).
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// organizations api-design 20: the keys and `organizations.maxApiKeys`, the most active keys the
// organization may hold (ruling 2026-10-30, treklink-web #119).
export interface ApiKeyList {
  items: ApiKey[];
  limit: number;
}

export const apiKeyKeys = {
  list: (organizationId: string) => ['org-api-keys', organizationId] as const,
};

// The Org Manager reads their own organization; TrekLink Staff and Admin read any (ruling 2026-10-30).
// It refetches when the window regains focus, so the last use stays current (screen 3.4).
export const useApiKeys = (organizationId: string | undefined) =>
  useQuery({
    queryKey: apiKeyKeys.list(organizationId ?? ''),
    queryFn: () => apiClient<ApiKeyList>(`/organizations/${organizationId}/api-keys`),
    enabled: Boolean(organizationId),
    refetchOnWindowFocus: true,
  });

export const isActiveKey = (key: ApiKey): boolean => key.revokedAt === null;
