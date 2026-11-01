import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors';
import { DemoGuardService, isLoopbackDatabaseUrl } from './demo-guard.service';

const NEON =
  'postgresql://owner:secret@ep-quiet-sky-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/treklink?sslmode=require';
const LOCAL = 'postgresql://postgres:postgrespassword@localhost:5432/treklink?schema=public';

// DATABASE_DIRECT_URL is local unless a case sets it.
const guardWith = (env: Record<string, unknown>) => {
  const all: Record<string, unknown> = { DATABASE_DIRECT_URL: LOCAL, ...env };
  return new DemoGuardService({ get: (key: string) => all[key] } as unknown as ConfigService<
    never,
    true
  >);
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as DomainException;
    return [e.getStatus(), (e.getResponse() as { errorCode: string }).errorCode, e.message];
  }
  return null;
};

describe('isLoopbackDatabaseUrl', () => {
  it.each([
    LOCAL,
    'postgresql://u:p@LOCALHOST:5432/db',
    'postgres://u:p@127.0.0.1:5432/db',
    'postgres://u:p@127.10.20.30/db',
    'postgresql://u:p@[::1]:5432/db',
  ])('accepts the loopback host of %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(true);
  });

  it.each([
    NEON,
    'postgresql://u:p@db.internal:5432/db',
    'postgresql://u:p@128.0.0.1:5432/db',
    'postgresql://u:p@127.0.0.256:5432/db',
    'postgresql://u:p@localhost.neon.tech/db',
    'postgresql://u:p@10.0.0.5/db',
    'not a url',
    'postgresql://u:p@localhost,ep-x.neon.tech:5432/db',
    'postgresql://u:p@/db?host=/var/run/postgresql',
  ])('refuses %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(false);
  });
});

// Review of treklink-web#245: Prisma connects to a `host` query parameter, so the URL authority alone
// proves nothing.
describe('isLoopbackDatabaseUrl with a connection-target query parameter', () => {
  it.each([
    'postgresql://u:p@localhost:5432/neondb?host=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?schema=public&host=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?HOST=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?Host=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?%68ost=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?%48%4F%53%54=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?%2568ost=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?+host=ep-x.neon.tech',
    'postgresql://u:p@localhost:5432/neondb?host=127.0.0.1',
    'postgresql://u:p@127.0.0.1:5432/neondb?hostaddr=3.1.2.3',
    'postgresql://u:p@127.0.0.1:5432/neondb?HostAddr=3.1.2.3',
    'postgresql://u:p@localhost/db?service=neon',
    'postgresql://u:p@localhost/db?servicefile=/tmp/pg_service.conf',
    'postgresql://u:p@[::1]:5432/db?sslmode=require&host=ep-x.neon.tech',
  ])('refuses %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(false);
  });

  it('keeps accepting the parameters that do not move the connection', () => {
    expect(
      isLoopbackDatabaseUrl(
        'postgresql://u:p@localhost:5432/db?schema=demo&sslmode=disable&connection_limit=5&hosting=x',
      ),
    ).toBe(true);
  });
});

describe('DemoGuardService', () => {
  it('refuses production first, with 403 DEMO_DISABLED, even on a local database', async () => {
    const work = jest.fn();
    const guard = guardWith({ NODE_ENV: 'production', DATABASE_URL: LOCAL });
    expect(await codeOf(guard.run(work))).toEqual([
      403,
      'DEMO_DISABLED',
      'Demo controls are disabled in production.',
    ]);
    expect(work).not.toHaveBeenCalled();
  });

  it('refuses a Neon database with 403 DEMO_DATABASE_NOT_LOCAL and runs nothing', async () => {
    const work = jest.fn();
    const guard = guardWith({ NODE_ENV: 'development', DATABASE_URL: NEON });
    expect(await codeOf(guard.run(work))).toEqual([
      403,
      'DEMO_DATABASE_NOT_LOCAL',
      'Demo controls run only against a local database.',
    ]);
    expect(work).not.toHaveBeenCalled();
    expect(guard.facts()).toEqual({ enabled: true, databaseLocal: false });
  });

  it.each([
    ['DATABASE_URL', 'postgresql://u:p@localhost:5432/neondb?host=ep-x.neon.tech'],
    ['DATABASE_DIRECT_URL', NEON],
    ['DATABASE_DIRECT_URL', 'postgresql://u:p@localhost:5432/neondb?HOST=ep-x.neon.tech'],
  ])('refuses when %s leaves the machine (%s)', async (name, url) => {
    const work = jest.fn();
    const guard = guardWith({ NODE_ENV: 'development', DATABASE_URL: LOCAL, [name]: url });
    expect((await codeOf(guard.run(work)))?.slice(0, 2)).toEqual([403, 'DEMO_DATABASE_NOT_LOCAL']);
    expect(work).not.toHaveBeenCalled();
    expect(guard.facts().databaseLocal).toBe(false);
  });

  it('refuses a second action while one runs with 409 DEMO_BUSY, and frees the lock after', async () => {
    const guard = guardWith({ NODE_ENV: 'development', DATABASE_URL: LOCAL });
    let release!: () => void;
    const first = guard.run(
      () => new Promise<string>((resolve) => (release = () => resolve('done'))),
    );
    expect((await codeOf(guard.run(() => Promise.resolve('second'))))?.slice(0, 2)).toEqual([
      409,
      'DEMO_BUSY',
    ]);
    release();
    await expect(first).resolves.toBe('done');
    await expect(guard.run(() => Promise.resolve('third'))).resolves.toBe('third');
  });

  it('frees the lock when the action fails', async () => {
    const guard = guardWith({ NODE_ENV: 'test', DATABASE_URL: LOCAL });
    await expect(guard.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(guard.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });
});
