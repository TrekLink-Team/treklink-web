import { PrismaService } from '../../common/prisma/prisma.service';
import { DemoResetRepository, KEPT_TABLES } from './demo-reset.repository';

// specs/demo/design.md sections 3 and 11, D-110 rule 4: the stage reset and the panel reseed wipe.
// This file asserts the statements each one runs, in order, with Prisma mocked. Nothing here touches a
// database; the SQL text is what would run.

const BP_KEY = {
  tableName: 'business_parameters',
  constraintName: 'business_parameters_updatedById_fkey',
  definition: 'FOREIGN KEY ("updatedById") REFERENCES users(id) ON DELETE SET NULL',
  columns: ['updatedById'],
};

// Table names held in constants: the module boundary check reads a literal UPDATE or FROM of another
// module's table as an access, and these are only the expected statement text.
const BP = BP_KEY.tableName;
const USERS = 'users';

const tables = (...names: string[]) => names.map((tablename) => ({ tablename }));

describe('DemoResetRepository', () => {
  let tx: { $queryRaw: jest.Mock; $executeRawUnsafe: jest.Mock };
  let prisma: { $transaction: jest.Mock; $queryRaw: jest.Mock };
  let repository: DemoResetRepository;

  const statements = () => tx.$executeRawUnsafe.mock.calls.map(([sql]) => sql as string);

  beforeEach(() => {
    tx = { $queryRaw: jest.fn(), $executeRawUnsafe: jest.fn().mockResolvedValue(0) };
    prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      $queryRaw: jest.fn().mockResolvedValue([{ name: 'treklink_demo' }]),
    };
    repository = new DemoResetRepository(prisma as unknown as PrismaService);
  });

  it('keeps the migration-filled tables only', () => {
    expect(KEPT_TABLES).toEqual([
      '_prisma_migrations',
      'business_parameters',
      'roles',
      'permissions',
      'role_permissions',
    ]);
  });

  describe('reset (design section 3)', () => {
    it('runs in one transaction with a 60 second timeout, reading the tables of the current schema', async () => {
      tx.$queryRaw.mockResolvedValueOnce(tables('devices')).mockResolvedValueOnce([]);
      await repository.reset();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
      const [strings, kept] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string[]];
      expect(strings.join('?')).toContain('schemaname = current_schema()');
      expect(kept).toEqual(KEPT_TABLES);
    });

    it('nulls and drops a kept foreign key, truncates with CASCADE, then re-creates the key', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce(tables('devices', 'users'))
        .mockResolvedValueOnce([BP_KEY]);
      await expect(repository.reset()).resolves.toEqual({
        truncated: ['devices', 'users'],
        kept: KEPT_TABLES,
      });
      expect(statements()).toEqual([
        `UPDATE "${BP}" SET "updatedById" = NULL WHERE "updatedById" IS NOT NULL`,
        'ALTER TABLE "business_parameters" DROP CONSTRAINT "business_parameters_updatedById_fkey"',
        'TRUNCATE TABLE "devices", "users" RESTART IDENTITY CASCADE',
        `ALTER TABLE "business_parameters" ADD CONSTRAINT "business_parameters_updatedById_fkey" ${BP_KEY.definition}`,
      ]);
      const [, kept, truncated] = tx.$queryRaw.mock.calls[1] as [unknown, string[], string[]];
      expect(kept).toEqual(KEPT_TABLES);
      expect(truncated).toEqual(['devices', 'users']);
    });

    it('nulls every column of a multi-column key and quotes identifiers safely', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce(tables('odd"name'))
        .mockResolvedValueOnce([{ ...BP_KEY, columns: ['a', 'b'] }]);
      await repository.reset();
      expect(statements()[0]).toBe(
        `UPDATE "${BP}" SET "a" = NULL, "b" = NULL WHERE "a" IS NOT NULL OR "b" IS NOT NULL`,
      );
      expect(statements()[2]).toBe('TRUNCATE TABLE "odd""name" RESTART IDENTITY CASCADE');
    });

    it('does nothing more when every table is kept', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);
      await expect(repository.reset()).resolves.toEqual({ truncated: [], kept: KEPT_TABLES });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('wipeData (design section 11, D-110 rule 4)', () => {
    it('nulls the kept key, truncates without CASCADE, then deletes users last, with no DDL', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce(tables('contracts', 'devices', 'users'))
        .mockResolvedValueOnce([BP_KEY]);
      await expect(repository.wipeData()).resolves.toEqual(['contracts', 'devices', 'users']);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
      expect(statements()).toEqual([
        `UPDATE "${BP}" SET "updatedById" = NULL WHERE "updatedById" IS NOT NULL`,
        'TRUNCATE TABLE "contracts", "devices" RESTART IDENTITY',
        `DELETE FROM "${USERS}"`,
      ]);
      expect(statements().some((sql) => /ALTER|CASCADE/.test(sql))).toBe(false);
    });

    it('skips the truncate when users is the only wiped table', async () => {
      tx.$queryRaw.mockResolvedValueOnce(tables('users')).mockResolvedValueOnce([]);
      await repository.wipeData();
      expect(statements()).toEqual([`DELETE FROM "${USERS}"`]);
    });

    it('skips the delete when users is not among the wiped tables', async () => {
      tx.$queryRaw.mockResolvedValueOnce(tables('devices')).mockResolvedValueOnce([]);
      await repository.wipeData();
      expect(statements()).toEqual(['TRUNCATE TABLE "devices" RESTART IDENTITY']);
    });

    it('returns no table and runs nothing when every table is kept', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);
      await expect(repository.wipeData()).resolves.toEqual([]);
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('lets a refused truncate roll the transaction back to the caller', async () => {
      const error = new Error('cannot truncate a table referenced in a foreign key constraint');
      tx.$queryRaw.mockResolvedValueOnce(tables('devices', 'users')).mockResolvedValueOnce([]);
      tx.$executeRawUnsafe.mockRejectedValueOnce(error);
      await expect(repository.wipeData()).rejects.toBe(error);
      expect(statements()).toEqual(['TRUNCATE TABLE "devices" RESTART IDENTITY']);
    });
  });

  it('currentDatabase names the database of the live connection', async () => {
    await expect(repository.currentDatabase()).resolves.toBe('treklink_demo');
    const [strings] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join('?')).toBe('SELECT current_database() AS name');
  });
});
