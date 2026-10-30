// Emitted after commit when an organization API key is revoked (design §5, platform design §2.3).
// `monitoring` closes the sockets opened with that key and no other socket of the organization.
export const API_KEY_REVOKED = 'apiKey.revoked';

export interface ApiKeyRevokedEvent {
  organizationId: string;
  apiKeyId: string;
}
