import { Injectable, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

// How long an interactive transaction may wait for a pooled connection and for the database to start
// it. Prisma's default is 2 s. A Neon compute that wakes from suspend, reached from the AWS host in
// Sydney over the link to Singapore, takes longer, and the transaction then failed to start with P2028
// (treklink-web#533). Waiting holds no connection, so a client-wide value cannot starve the pool the way
// a client-wide `timeout` did (treklink-web#487); each call keeps Prisma's 5 s `timeout` unless it
// passes its own. Prisma merges a call's options field by field over these, so this applies to every
// transaction, `SLOW_LINK_TRANSACTION` included.
export const TRANSACTION_MAX_WAIT_MS = 20_000;

export const PRISMA_CLIENT_OPTIONS = {
  transactionOptions: { maxWait: TRANSACTION_MAX_WAIT_MS },
} as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Nest injects nothing here; the database specs pass their own `datasourceUrl`.
  constructor(@Optional() options?: Prisma.PrismaClientOptions) {
    super({
      ...options,
      transactionOptions: {
        ...PRISMA_CLIENT_OPTIONS.transactionOptions,
        ...options?.transactionOptions,
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
