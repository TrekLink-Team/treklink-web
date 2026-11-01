import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors';
import { DemoGuardService, isLoopbackDatabaseUrl } from './demo-guard.service';

const NEON =
  'postgresql://owner:secret@ep-quiet-sky-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/treklink?sslmode=require';
const LOCAL = 'postgresql://postgres:postgrespassword@localhost:5432/treklink?schema=public';

const guardWith = (env: Record<string, unknown>) =>
  new DemoGuardService({ get: (key: string) => env[key] } as unknown as ConfigService<never, true>);

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
  ])('refuses %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(false);
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
