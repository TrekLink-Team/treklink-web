import type { ApiKey } from '../../entities/api-key/api';
import { apiClient } from '../../shared/api/apiClient';

// The create answer carries the full key once (organizations api-design 21). The caller keeps it in
// the open dialog's state only: never in the query cache, the URL or browser storage.
export interface CreatedApiKey extends ApiKey {
  key: string;
}

// POST /api/organizations/:id/api-keys, Org Manager of the organization.
export const createApiKey = (organizationId: string, name: string) =>
  apiClient<CreatedApiKey>(`/organizations/${organizationId}/api-keys`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

// POST /api/organizations/:id/api-keys/:keyId/revoke (organizations api-design 22).
export const revokeApiKey = (organizationId: string, keyId: string) =>
  apiClient<ApiKey>(`/organizations/${organizationId}/api-keys/${keyId}/revoke`, { method: 'POST' });

// Mirrors CreateApiKeyDto: trimmed, not blank, at most 100 characters.
export const NAME_MAX_LENGTH = 100;

// MSG02 for a blank name.
export const nameError = (name: string): string | null => {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name is required.';
  if (trimmed.length > NAME_MAX_LENGTH) return `Name must be at most ${NAME_MAX_LENGTH} characters.`;
  return null;
};
