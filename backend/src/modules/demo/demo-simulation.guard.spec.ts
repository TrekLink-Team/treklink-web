import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import {
  DemoSimulationGuard,
  databaseNameOf,
  isSimulationDatabaseUrl,
} from './demo-simulation.guard';

const NEON_DEV = 'postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const NEON_STAGING =
  'postgresql://u:p@ep-y.ap-southeast-1.aws.neon.tech/treklink_prod?sslmode=require';
const LOCAL = 'postgresql://u:p@localhost:5432/treklink';

const guardOf = (env: Partial<ValidatedEnvironment>) =>
  new DemoSimulationGuard({
    get: (key: keyof ValidatedEnvironment) => env[key],
  } as unknown as ConfigService<ValidatedEnvironment, true>);

describe('DemoSimulationGuard (specs/demo REQ-SIM-02, design §9)', () => {
  it('reads the database name of a URL', () => {
    expect(databaseNameOf(NEON_STAGING)).toBe('treklink_prod');
    expect(databaseNameOf('postgresql://u:p@h/treklink%5Fprod')).toBe('treklink_prod');
    expect(databaseNameOf('not a url')).toBeNull();
  });

  it.each([
    [LOCAL, true],
    ['postgresql://u:p@127.0.0.1/any', true],
    [NEON_STAGING, true],
    [NEON_DEV, false],
    ['postgresql://u:p@ep-x.neon.tech/treklink_prod_copy', false],
    ['postgresql://u:p@localhost/neondb?host=ep-x.neon.tech', false],
    ['not a url', false],
  ])('accepts %s: %s', (url, expected) => {
    expect(isSimulationDatabaseUrl(url)).toBe(expected);
  });

  // Review of treklink-web#307: the staging branch read only the path, so a query parameter could move
  // the connection to another host or another database while the path still said treklink_prod.
  const STAGING_HOST = 'postgresql://u:p@ep-y.ap-southeast-1.aws.neon.tech/treklink_prod';
  it.each([
    `${STAGING_HOST}?host=ep-dev.neon.tech`,
    `${STAGING_HOST}?HOST=ep-dev.neon.tech`,
    `${STAGING_HOST}?%68ost=ep-dev.neon.tech`,
    `${STAGING_HOST}?%2568ost=ep-dev.neon.tech`,
    `${STAGING_HOST}?hostaddr=10.0.0.1`,
    `${STAGING_HOST}?service=dev`,
    `${STAGING_HOST}?servicefile=/tmp/pg_service.conf`,
    `${STAGING_HOST}?dbname=neondb`,
    `${STAGING_HOST}?database=neondb`,
    `${STAGING_HOST}?sslmode=require&%44BNAME=neondb`,
  ])('refuses the staging name with a target-changing parameter: %s', (url) => {
    expect(isSimulationDatabaseUrl(url)).toBe(false);
  });

  it('accepts plain treklink_prod and a loopback URL', () => {
    expect(isSimulationDatabaseUrl(STAGING_HOST)).toBe(true);
    expect(isSimulationDatabaseUrl(`${STAGING_HOST}?sslmode=require&connect_timeout=10`)).toBe(
      true,
    );
    expect(isSimulationDatabaseUrl('postgresql://u:p@localhost:5432/treklink_test')).toBe(true);
  });

  it('accepts the Vercel staging, treklink_prod, with NODE_ENV production', () => {
    const guard = guardOf({
      NODE_ENV: 'production',
      DATABASE_URL: NEON_STAGING,
      DATABASE_DIRECT_URL: NEON_STAGING.replace('ep-y', 'ep-y-direct'),
    });
    expect(guard.databaseAllowed()).toBe(true);
    expect(() =>
      guard.assertAllowed({ id: 'admin', roles: ['ADMIN'], organizationId: null }),
    ).not.toThrow();
  });

  it('refuses a Neon database not named treklink_prod with 403 DEMO_DATABASE_NOT_ALLOWED', () => {
    const guard = guardOf({ DATABASE_URL: NEON_DEV, DATABASE_DIRECT_URL: NEON_DEV });
    expect(guard.databaseAllowed()).toBe(false);
    let thrown: unknown;
    try {
      guard.assertAllowed({ id: 'admin', roles: ['ADMIN'], organizationId: null });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainException);
    expect((thrown as DomainException).getStatus()).toBe(403);
    expect((thrown as DomainException).errorCode).toBe(ErrorCode.DEMO_DATABASE_NOT_ALLOWED);
  });

  it('checks the direct URL too', () => {
    expect(guardOf({ DATABASE_URL: LOCAL, DATABASE_DIRECT_URL: NEON_DEV }).databaseAllowed()).toBe(
      false,
    );
    expect(guardOf({ DATABASE_URL: LOCAL, DATABASE_DIRECT_URL: LOCAL }).databaseAllowed()).toBe(
      true,
    );
  });
});

describe('W43 simulator command roles', () => {
  it.each(['STAFF', 'ORG_MANAGER', 'ORG_OPERATOR'])('refuses %s before database work', (role) => {
    const guard = guardOf({ DATABASE_URL: LOCAL, DATABASE_DIRECT_URL: LOCAL });
    let refusal: unknown = null;
    try {
      guard.assertAllowed({ id: 'caller', roles: [role], organizationId: null });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ httpStatus: 403, errorCode: ErrorCode.FORBIDDEN });
  });
  it('refuses an organization-scoped Admin', () => {
    const guard = guardOf({ DATABASE_URL: LOCAL, DATABASE_DIRECT_URL: LOCAL });
    expect(() =>
      guard.assertAllowed({ id: 'caller', roles: ['ADMIN'], organizationId: 'org' }),
    ).toThrow(DomainException);
  });
});
