import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ErrorCode } from '../src/common/errors';
import { hashApiKey } from '../src/modules/auth';
import { API_KEY_REVOKED } from '../src/modules/organizations';
import { ApiKeysRepository } from '../src/modules/organizations/api-keys.repository';
import { ApiKeysService } from '../src/modules/organizations/api-keys.service';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { OrganizationApiKeyResolver } from '../src/modules/organizations/providers/api-key-resolver.provider';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Organizations 2.7 and the API_KEY_RESOLVER port against Postgres (AC-05 minus HTTP): the limit holds
// under concurrent creates, the resolver finds a live key by hash, and a revoked key stops resolving.
// Fixtures carry a fresh run id; nothing existing is deleted.
describe('organization API keys against Postgres (organizations 1.3 and 2.7)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const revoked: unknown[] = [];
  emitter.on(API_KEY_REVOKED, (event) => revoked.push(event));
  const keys = new ApiKeysRepository(prisma);
  const parameters = { get: () => Promise.resolve(2) } as unknown as ParameterService;
  const service = new ApiKeysService(
    keys,
    new OrganizationsRepository(prisma),
    parameters,
    new TransactionalEvents(prisma, emitter),
  );
  const resolver = new OrganizationApiKeyResolver(keys);
  const run = randomUUID().slice(0, 8);
  let organizationId: string;
  let manager: { id: string; roles: string[]; organizationId: string };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `keys-${run}@example.test`,
        fullName: 'Key Manager',
        accountType: 'ORGANIZATION',
      },
    });
    const organization = await prisma.organization.create({
      data: {
        code: `KEY-${run}`,
        legalName: `Key Test ${run}`,
        taxCode: `9${Date.now()}`.slice(0, 10),
        address: '1 Test Street',
        contactEmail: `keys-${run}@example.test`,
        contactPhone: '0900000000',
        status: 'ACTIVE',
      },
    });
    organizationId = organization.id;
    manager = { id: user.id, roles: ['ORG_MANAGER'], organizationId };
  });

  afterAll(() => prisma.$disconnect());

  it('creates keys up to the limit, also when two creates race for the last slot', async () => {
    const first = await service.create(organizationId, 'First', manager);
    const results = await Promise.allSettled([
      service.create(organizationId, 'Second', manager),
      service.create(organizationId, 'Third', manager),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ errorCode: ErrorCode.KEY_LIMIT });
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.keyHash).toBe(hashApiKey(first.key));
    expect(stored.prefix).toBe(first.key.slice(0, 8));
  });

  it('lists the keys with the limit and never the hash or the secret', async () => {
    const list = await service.list(organizationId, manager);
    expect(list.limit).toBe(2);
    expect(list.items).toHaveLength(2);
    expect(Object.keys(list.items[0]).sort()).toEqual(
      ['createdAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt'].sort(),
    );
  });

  it('resolves a live key by hash and records its use once a minute', async () => {
    const created = await prisma.apiKey.findFirstOrThrow({
      where: { organizationId, name: 'First' },
    });
    const key = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    const at = new Date();
    await expect(resolver.resolve(key.keyHash, at)).resolves.toEqual({
      apiKeyId: key.id,
      organizationId,
    });
    const used = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(used.lastUsedAt).toEqual(at);
    await resolver.resolve(key.keyHash, new Date(at.getTime() + 10_000));
    const again = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(again.lastUsedAt).toEqual(at);
  });

  it('stops resolving a revoked key, emits apiKey.revoked and frees a slot', async () => {
    const key = await prisma.apiKey.findFirstOrThrow({ where: { organizationId, name: 'First' } });
    const saved = await service.revoke(organizationId, key.id, manager);
    expect(saved.revokedAt).not.toBeNull();
    await expect(resolver.resolve(key.keyHash)).resolves.toBeNull();
    expect(revoked).toEqual([{ organizationId, apiKeyId: key.id }]);
    await expect(service.create(organizationId, 'Replacement', manager)).resolves.toMatchObject({
      name: 'Replacement',
    });
  });
});
