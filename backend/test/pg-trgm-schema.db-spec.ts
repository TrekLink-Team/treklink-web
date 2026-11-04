import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}
if (/\.neon\.tech/i.test(databaseUrl)) {
  throw new Error(
    'pg-trgm-schema.db-spec creates and drops a database; never run it against Neon.',
  );
}

// Migration 20261104090000_contract_code_search (rentals REQ-EVT-26) on a database where pg_trgm is
// already installed in a schema other than public, as a hosted database may keep it in "extensions":
// the migration must leave the extension where it is and build the index with that schema's
// gin_trgm_ops, for the public schema and for a second Prisma schema in the same database (review of
// treklink-web#353). The suite creates a disposable database of its own, migrates it with
// `prisma migrate deploy`, and drops it at the end.
describe('contract search index with pg_trgm in another schema (migration 20261104090000)', () => {
  const name = `treklink_trgm_${randomUUID().slice(0, 8)}`;
  const admin = new PrismaService({ datasourceUrl: databaseUrl });
  const urlOf = (schema: string) => {
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    url.searchParams.set('schema', schema);
    return url.toString();
  };
  const scratch = new PrismaService({ datasourceUrl: urlOf('public') });

  const migrate = (schema: string) =>
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: urlOf(schema), DATABASE_DIRECT_URL: urlOf(schema) },
        stdio: 'pipe',
      },
    ).toString();

  const indexDefinition = async (schema: string) =>
    (
      await scratch.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
         WHERE schemaname = ${schema} AND indexname = 'rental_contracts_code_trgm'`
    ).map((row) => row.indexdef);

  const extensionSchemas = async () =>
    (
      await scratch.$queryRaw<{ nspname: string }[]>`
        SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'pg_trgm'`
    ).map((row) => row.nspname);

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    await scratch.$executeRawUnsafe('CREATE SCHEMA extensions');
    await scratch.$executeRawUnsafe('CREATE EXTENSION pg_trgm WITH SCHEMA extensions');
  }, 60_000);

  afterAll(async () => {
    await scratch.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  });

  it('migrates public, keeps pg_trgm in "extensions" and builds the index with its operator class', async () => {
    expect(() => migrate('public')).not.toThrow();
    expect(await extensionSchemas()).toEqual(['extensions']);
    const [definition] = await indexDefinition('public');
    expect(definition).toContain('USING gin');
    expect(definition).toContain('extensions.gin_trgm_ops');

    // The planner reaches a substring ILIKE through the index.
    const plan = await scratch.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT id FROM public.rental_contracts WHERE code ILIKE '%2026-00%'`,
      );
    });
    expect(plan.map((line) => line['QUERY PLAN']).join('\n')).toContain(
      'rental_contracts_code_trgm',
    );
  }, 120_000);

  it('migrates a second Prisma schema in the same database with the same operator class', async () => {
    expect(() => migrate('suite_two')).not.toThrow();
    expect(await extensionSchemas()).toEqual(['extensions']);
    const [definition] = await indexDefinition('suite_two');
    expect(definition).toContain('extensions.gin_trgm_ops');
  }, 120_000);
});
