import { Caller } from '../../common/decorators/access.decorator';
import { DomainException } from '../../common/errors';
import { ConfigService } from '@nestjs/config';
import { DemoQuickGuard } from './demo-quick.guard';
import { demoControlsEnabled } from './demo-flag';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

const actor = { id: 'admin', roles: ['ADMIN'], organizationId: null };
const LOCAL = 'postgresql://u:p@localhost/demo';
const STAGING = 'postgresql://u:p@ep-stage.neon.tech/treklink_prod';
const make = (overrides = {}) => {
  const env: Record<string, unknown> = {
    NODE_ENV: 'production',
    DEMO_CONTROLS_ENABLED: true,
    VITE_APP_ENV: 'staging',
    DATABASE_URL: STAGING,
    DATABASE_DIRECT_URL: STAGING,
    ...overrides,
  };
  return new DemoQuickGuard({ get: (key: string) => env[key] } as ConfigService<
    ValidatedEnvironment,
    true
  >);
};

const refusal = (guard: DemoQuickGuard, caller: Caller = actor) => {
  try {
    guard.assert(caller);
  } catch (error) {
    if (error instanceof DomainException)
      return { errorCode: error.errorCode, status: error.getStatus() };
    throw error;
  }
  throw new Error('Expected the guard to refuse this caller.');
};

describe('W43 quick gate', () => {
  it('allows Vercel staging production without issuing a role-switch session', () =>
    expect(() => make().assert(actor)).not.toThrow());
  it('allows a local sandbox', () =>
    expect(() =>
      make({
        NODE_ENV: 'development',
        VITE_APP_ENV: 'sandbox',
        DATABASE_URL: LOCAL,
        DATABASE_DIRECT_URL: LOCAL,
      }).assert(actor),
    ).not.toThrow());
  it.each([
    { DEMO_CONTROLS_ENABLED: false },
    { VITE_APP_ENV: 'production' },
    { VITE_APP_ENV: 'aws' },
    { VITE_APP_ENV: undefined },
  ])('fails closed for %j', (env) => {
    expect(refusal(make(env))).toEqual({ errorCode: 'DEMO_DISABLED', status: 403 });
  });
  it.each(['STAFF', 'ORG_MANAGER', 'ORG_OPERATOR', ''])('refuses %s with 403', (role) =>
    expect(refusal(make(), { ...actor, roles: [role] })).toEqual({
      errorCode: 'FORBIDDEN',
      status: 403,
    }),
  );
  it('rejects an organization-scoped Admin', () =>
    expect(() => make().assert({ ...actor, organizationId: 'org' })).toThrow());
  it.each(['DATABASE_URL', 'DATABASE_DIRECT_URL'])(
    'checks %s against shared dev and target overrides',
    (key) => {
      for (const url of [
        'postgresql://u:p@ep-dev.neon.tech/neondb',
        `${STAGING}?HOST=ep-dev.neon.tech`,
        `${STAGING}?%2564bname=neondb`,
      ])
        expect(refusal(make({ [key]: url }))).toEqual({
          errorCode: 'DEMO_DATABASE_NOT_ALLOWED',
          status: 403,
        });
    },
  );
  it.each([undefined, 'production', 'development', 'aws'])(
    'does not even load the module for %s',
    (VITE_APP_ENV) =>
      expect(demoControlsEnabled({ DEMO_CONTROLS_ENABLED: 'true', VITE_APP_ENV })).toBe(false),
  );
});
