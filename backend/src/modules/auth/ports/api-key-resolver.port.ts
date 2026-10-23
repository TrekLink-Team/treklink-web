// Organization API keys (specs/auth/design.md §2). Declared by `auth`, provided by `organizations`
// (task 1.3); `ApiKeyGuard` (task 4.3) resolves `X-Api-Key` through it.
export const API_KEY_RESOLVER = Symbol('API_KEY_RESOLVER');

export interface ResolvedApiKey {
  apiKeyId: string;
  organizationId: string;
}

export interface ApiKeyResolver {
  // null for an unknown or revoked key; touches lastUsedAt at most once a minute
  resolve(keyHash: string): Promise<ResolvedApiKey | null>;
}
