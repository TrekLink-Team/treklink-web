import { Test } from '@nestjs/testing';
import { PrismaModule } from './prisma.module';
import { PrismaService, TRANSACTION_MAX_WAIT_MS } from './prisma.service';

// Prisma's resolved client options. The client merges a call's transaction options field by field over
// these (`_transactionWithCallback` in @prisma/client/runtime), so they are what a transaction gets.
const transactionOptionsOf = (prisma: PrismaService): { maxWait?: number; timeout?: number } =>
  (prisma as unknown as { _engineConfig: { transactionOptions: { maxWait?: number } } })
    ._engineConfig.transactionOptions;

// treklink-web#533: Prisma's default maxWait of 2 s failed the first transaction after an idle period.
describe('PrismaService', () => {
  it('gives every transaction the shared maxWait', () => {
    expect(transactionOptionsOf(new PrismaService()).maxWait).toBe(TRANSACTION_MAX_WAIT_MS);
  });

  it('keeps the shared maxWait when a database spec passes its own datasource', () => {
    const prisma = new PrismaService({ datasourceUrl: 'postgresql://u:p@localhost:5432/db' });

    expect(transactionOptionsOf(prisma).maxWait).toBe(TRANSACTION_MAX_WAIT_MS);
  });

  it('is built by Nest with the shared maxWait', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();

    expect(transactionOptionsOf(moduleRef.get(PrismaService)).maxWait).toBe(
      TRANSACTION_MAX_WAIT_MS,
    );
  });
});
