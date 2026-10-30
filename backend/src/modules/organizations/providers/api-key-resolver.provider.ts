import { Injectable } from '@nestjs/common';
import { ApiKeyResolver, ResolvedApiKey } from '../../auth';
import { ApiKeysRepository } from '../api-keys.repository';

// A use is recorded at most once in this window (auth port contract), so a polling client does not
// write on every request.
export const LAST_USED_WINDOW_MS = 60_000;

// Provides API_KEY_RESOLVER for `auth` (task 1.3): the live key behind a SHA-256 hash, or null for an
// unknown or revoked key. `ApiKeyGuard` and the `/live` handshake call it on every request and
// connection, so a revoked key stops at the next one (REQ-EVT-09).
@Injectable()
export class OrganizationApiKeyResolver implements ApiKeyResolver {
  constructor(private readonly keys: ApiKeysRepository) {}

  async resolve(keyHash: string, now: Date = new Date()): Promise<ResolvedApiKey | null> {
    const row = await this.keys.findLiveByHash(keyHash);
    if (!row) return null;
    const since = new Date(now.getTime() - LAST_USED_WINDOW_MS);
    if (!row.lastUsedAt || row.lastUsedAt < since) await this.keys.touch(row.id, now, since);
    return { apiKeyId: row.id, organizationId: row.organizationId };
  }
}
