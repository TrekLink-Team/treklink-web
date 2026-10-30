import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

// What a list or a revoke shows of a key (api-design 20 and 22). The hash never leaves this module.
export const API_KEY_VIEW = {
  id: true,
  name: true,
  prefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} satisfies Prisma.ApiKeySelect;

export type ApiKeyView = Prisma.ApiKeyGetPayload<{ select: typeof API_KEY_VIEW }>;

// Organization API keys (task 2.7). Every read is scoped to one organization.
@Injectable()
export class ApiKeysRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Newest first, revoked ones included (api-design 20).
  list(organizationId: string, client: Client = this.prisma): Promise<ApiKeyView[]> {
    return client.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: API_KEY_VIEW,
    });
  }

  countActive(organizationId: string, client: Client = this.prisma): Promise<number> {
    return client.apiKey.count({ where: { organizationId, revokedAt: null } });
  }

  insert(
    row: {
      organizationId: string;
      name: string;
      prefix: string;
      keyHash: string;
      createdById: string;
    },
    client: Client = this.prisma,
  ): Promise<ApiKeyView> {
    return client.apiKey.create({ data: row, select: API_KEY_VIEW });
  }

  find(
    organizationId: string,
    id: string,
    client: Client = this.prisma,
  ): Promise<ApiKeyView | null> {
    return client.apiKey.findFirst({ where: { id, organizationId }, select: API_KEY_VIEW });
  }

  // Sets the revocation once; null when the key was already revoked, so a second revoke is a no-op.
  async revoke(
    organizationId: string,
    id: string,
    by: string,
    at: Date,
    client: Client = this.prisma,
  ): Promise<ApiKeyView | null> {
    const { count } = await client.apiKey.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt: at, revokedById: by },
    });
    return count === 1 ? this.find(organizationId, id, client) : null;
  }

  // The live key behind a hash (API_KEY_RESOLVER); a revoked key is not found.
  findLiveByHash(keyHash: string, client: Client = this.prisma) {
    return client.apiKey.findFirst({
      where: { keyHash, revokedAt: null },
      select: { id: true, organizationId: true, lastUsedAt: true },
    });
  }

  // Records a use unless one was recorded after `since`, so a busy key writes at most once a minute.
  async touch(id: string, at: Date, since: Date, client: Client = this.prisma): Promise<void> {
    await client.apiKey.updateMany({
      where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: since } }] },
      data: { lastUsedAt: at },
    });
  }
}
