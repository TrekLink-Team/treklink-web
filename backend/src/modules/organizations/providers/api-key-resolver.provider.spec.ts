import { ApiKeysRepository } from '../api-keys.repository';
import { LAST_USED_WINDOW_MS, OrganizationApiKeyResolver } from './api-key-resolver.provider';

const NOW = new Date('2026-10-30T03:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('OrganizationApiKeyResolver (API_KEY_RESOLVER, task 1.3)', () => {
  let keys: { findLiveByHash: jest.Mock; touch: jest.Mock };
  let resolver: OrganizationApiKeyResolver;

  beforeEach(() => {
    keys = { findLiveByHash: jest.fn(), touch: jest.fn().mockResolvedValue(undefined) };
    resolver = new OrganizationApiKeyResolver(keys as unknown as ApiKeysRepository);
  });

  it('returns the key and its organization, and records a first use', async () => {
    keys.findLiveByHash.mockResolvedValue({ id: 'k-1', organizationId: 'org-1', lastUsedAt: null });
    await expect(resolver.resolve('hash', NOW)).resolves.toEqual({
      apiKeyId: 'k-1',
      organizationId: 'org-1',
    });
    expect(keys.findLiveByHash).toHaveBeenCalledWith('hash');
    expect(keys.touch).toHaveBeenCalledWith('k-1', NOW, ago(LAST_USED_WINDOW_MS));
  });

  it('does not rewrite lastUsedAt within a minute', async () => {
    keys.findLiveByHash.mockResolvedValue({
      id: 'k-1',
      organizationId: 'org-1',
      lastUsedAt: ago(30_000),
    });
    await resolver.resolve('hash', NOW);
    expect(keys.touch).not.toHaveBeenCalled();
  });

  it('records a use again after a minute', async () => {
    keys.findLiveByHash.mockResolvedValue({
      id: 'k-1',
      organizationId: 'org-1',
      lastUsedAt: ago(61_000),
    });
    await resolver.resolve('hash', NOW);
    expect(keys.touch).toHaveBeenCalled();
  });

  it('returns null for an unknown or revoked key, which the lookup does not find', async () => {
    keys.findLiveByHash.mockResolvedValue(null);
    await expect(resolver.resolve('hash')).resolves.toBeNull();
    expect(keys.touch).not.toHaveBeenCalled();
  });
});
