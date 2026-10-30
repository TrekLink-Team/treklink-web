import { PrismaService } from '../../common/prisma/prisma.service';
import { API_KEY_VIEW, ApiKeysRepository } from './api-keys.repository';

const AT = new Date('2026-10-30T03:00:00.000Z');

describe('ApiKeysRepository', () => {
  let apiKey: Record<string, jest.Mock>;
  let repository: ApiKeysRepository;

  beforeEach(() => {
    apiKey = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(2),
      create: jest.fn().mockResolvedValue({ id: 'k-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'k-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    repository = new ApiKeysRepository({ apiKey } as unknown as PrismaService);
  });

  it('lists one organization newest first, without the hash', async () => {
    await repository.list('org-1');
    expect(apiKey.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
      select: API_KEY_VIEW,
    });
    expect(API_KEY_VIEW).not.toHaveProperty('keyHash');
  });

  it('counts only active keys', async () => {
    await expect(repository.countActive('org-1')).resolves.toBe(2);
    expect(apiKey.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', revokedAt: null },
    });
  });

  it('inserts a row and finds one within its organization', async () => {
    const row = {
      organizationId: 'org-1',
      name: 'n',
      prefix: 'tlk_abcd',
      keyHash: 'h',
      createdById: 'u',
    };
    await repository.insert(row);
    expect(apiKey.create).toHaveBeenCalledWith({ data: row, select: API_KEY_VIEW });
    await repository.find('org-1', 'k-1');
    expect(apiKey.findFirst).toHaveBeenCalledWith({
      where: { id: 'k-1', organizationId: 'org-1' },
      select: API_KEY_VIEW,
    });
  });

  it('revokes only a live key, and returns null when none was updated', async () => {
    await expect(repository.revoke('org-1', 'k-1', 'u', AT)).resolves.toEqual({ id: 'k-1' });
    expect(apiKey.updateMany).toHaveBeenCalledWith({
      where: { id: 'k-1', organizationId: 'org-1', revokedAt: null },
      data: { revokedAt: AT, revokedById: 'u' },
    });
    apiKey.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.revoke('org-1', 'k-1', 'u', AT)).resolves.toBeNull();
  });

  it('looks a hash up among live keys and touches lastUsedAt only when older than the window', async () => {
    await repository.findLiveByHash('h');
    expect(apiKey.findFirst).toHaveBeenCalledWith({
      where: { keyHash: 'h', revokedAt: null },
      select: { id: true, organizationId: true, lastUsedAt: true },
    });
    const since = new Date(AT.getTime() - 60_000);
    await repository.touch('k-1', AT, since);
    expect(apiKey.updateMany).toHaveBeenCalledWith({
      where: { id: 'k-1', OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: since } }] },
      data: { lastUsedAt: AT },
    });
  });
});
