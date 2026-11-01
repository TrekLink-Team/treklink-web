import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { CHECK_POLICIES_KEY, IS_PUBLIC_KEY } from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DomainException } from '../../common/errors';
import { DemoAccountsController } from './demo-accounts.controller';
import { DemoAccountsModule } from './demo-accounts.module';
import { DemoAccountsService } from './demo-accounts.service';
import { demoControlsEnabled, demoTestAccountsEnabled } from './demo-flag';
import { DemoGuardService } from './demo-guard.service';
import { DemoModule } from './demo.module';
import { loadSeedModule } from './demo-seed.runner';

const NEON =
  'postgresql://owner:secret@ep-quiet-sky-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/treklink?sslmode=require';

const ENV = {
  SEED_ADMIN_PASSWORD: 'Admin-Pass-1',
  SEED_STAFF_PASSWORD: 'Staff-Pass-2',
  SEED_MANAGER_PASSWORD: 'Manager-Pass-3',
  SEED_OPERATOR_PASSWORD: 'Operator-Pass-4',
};

// The real seed file: its SEEDED_ACCOUNTS and readPasswords.
const service = () => new DemoAccountsService(loadSeedModule);

const refusal = async (work: () => unknown) => {
  try {
    await work();
  } catch (error) {
    const e = error as DomainException;
    return [e.getStatus(), (e.getResponse() as { errorCode: string }).errorCode];
  }
  return null;
};

const metadataOf = (key: string) =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(DemoAccountsController.prototype, 'accounts')!.value as object,
  ) as unknown;

// Sets the given variables for one block and restores them afterwards.
const withEnv = (vars: Record<string, string>) => {
  const previous: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [key, value] of Object.entries(vars)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
};

// The two registrations of app.module.ts, on an otherwise empty app with a probe route.
@Controller('probe')
class ProbeController {
  @Get()
  ok() {
    return 'ok';
  }
}

const bootApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true }),
      ConditionalModule.registerWhen(DemoModule, demoControlsEnabled),
      ConditionalModule.registerWhen(DemoAccountsModule, demoTestAccountsEnabled),
    ],
    controllers: [ProbeController],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
};

const serverOf = (app: INestApplication) => app.getHttpServer() as Parameters<typeof request>[0];

describe('DemoAccountsService (specs/demo REQ-EVT-05)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the four seeded accounts in order, with the passwords of the environment', () => {
    expect(service().list(ENV)).toEqual({
      accounts: [
        {
          role: 'ADMIN',
          roleLabel: 'TrekLink Admin',
          email: 'admin@treklink.local',
          password: 'Admin-Pass-1',
          fullName: 'Demo Admin',
          organization: null,
        },
        {
          role: 'STAFF',
          roleLabel: 'TrekLink Staff',
          email: 'staff@treklink.local',
          password: 'Staff-Pass-2',
          fullName: 'Demo Staff',
          organization: null,
        },
        {
          role: 'ORG_MANAGER',
          roleLabel: 'Org Manager',
          email: 'manager@treklink.local',
          password: 'Manager-Pass-3',
          fullName: 'Demo Manager',
          organization: 'ORG-0001',
        },
        {
          role: 'ORG_OPERATOR',
          roleLabel: 'Org Operator',
          email: 'operator@treklink.local',
          password: 'Operator-Pass-4',
          fullName: 'Demo Operator',
          organization: 'ORG-0001',
        },
      ],
    });
  });

  it('reads the passwords at request time, so a changed variable shows at once', () => {
    const accounts = service();
    expect(accounts.list(ENV).accounts[0].password).toBe('Admin-Pass-1');
    const changed = { ...ENV, SEED_ADMIN_PASSWORD: 'Changed-Pass-9' };
    expect(accounts.list(changed).accounts[0].password).toBe('Changed-Pass-9');
  });

  it('answers 409 DEMO_SEED_NOT_CONFIGURED when a password variable is missing', async () => {
    const { SEED_STAFF_PASSWORD: _omit, ...partial } = ENV;
    void _omit;
    expect(await refusal(() => service().list(partial))).toEqual([409, 'DEMO_SEED_NOT_CONFIGURED']);
  });

  it('writes no password to any log call', async () => {
    const calls: unknown[][] = [];
    const record = (...args: unknown[]) => void calls.push(args);
    for (const method of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation(record);
      jest.spyOn(Logger, method).mockImplementation(record);
    }
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(console, method).mockImplementation(record);
    }
    service().list(ENV);
    const { SEED_STAFF_PASSWORD: _omit, ...partial } = ENV;
    void _omit;
    await refusal(() => service().list(partial));
    const logged = JSON.stringify(calls);
    for (const password of Object.values(ENV)) expect(logged).not.toContain(password);
  });
});

describe('DemoAccountsController', () => {
  it('is public, never cached and has no policy', () => {
    expect(metadataOf(IS_PUBLIC_KEY)).toBe(true);
    expect(metadataOf(CHECK_POLICIES_KEY)).toBeUndefined();
    expect(metadataOf(RESPONSE_MESSAGE_KEY)).toBe('OK');
    expect(metadataOf(HEADERS_METADATA)).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
  });

  it('hands the service result to the envelope', () => {
    const list = jest.fn().mockReturnValue({ accounts: [] });
    const controller = new DemoAccountsController({ list } as unknown as DemoAccountsService);
    expect(controller.accounts()).toEqual({ accounts: [] });
    expect(list).toHaveBeenCalledTimes(1);
  });
});

// D-089: the accounts list answers in production on a Neon database once its own flag is on, while the
// stage of the control panel still refuses there (design §2).
describe('production on a Neon database with DEMO_TEST_ACCOUNTS_ENABLED on', () => {
  withEnv({
    DEMO_TEST_ACCOUNTS_ENABLED: 'true',
    DEMO_CONTROLS_ENABLED: 'false',
    NODE_ENV: 'production',
    DATABASE_URL: NEON,
    DATABASE_DIRECT_URL: NEON,
    ...ENV,
  });
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(() => app.close());

  it('answers GET /api/demo/accounts with the four accounts and no-store', async () => {
    const response = await request(serverOf(app)).get('/api/demo/accounts').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as { accounts: { email: string; password: string }[] };
    expect(body.accounts.map((a) => a.password)).toEqual(Object.values(ENV));
  });

  it('leaves every control panel route a 404', async () => {
    const server = serverOf(app);
    await request(server).get('/api/demo/status').expect(404);
    await request(server).post('/api/demo/scenarios/clean/stage').expect(404);
    await request(server).post('/api/demo/switch-role').send({ role: 'ADMIN' }).expect(404);
  });

  it('keeps the stage refusing with 403 there, even with the control panel flag on', async () => {
    const config = { get: (key: string) => process.env[key] } as unknown as ConfigService<
      never,
      true
    >;
    const work = jest.fn();
    expect(await refusal(() => new DemoGuardService(config).run(work))).toEqual([
      403,
      'DEMO_DISABLED',
    ]);
    process.env.NODE_ENV = 'development';
    expect(await refusal(() => new DemoGuardService(config).run(work))).toEqual([
      403,
      'DEMO_DATABASE_NOT_LOCAL',
    ]);
    process.env.NODE_ENV = 'production';
    expect(work).not.toHaveBeenCalled();
  });
});

// REQ-UBI-01 and REQ-EVT-05: with both flags off neither module is loaded and every demo route is a 404.
describe('both demo flags off', () => {
  withEnv({ DEMO_TEST_ACCOUNTS_ENABLED: 'false', DEMO_CONTROLS_ENABLED: 'false', ...ENV });
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(() => app.close());

  it('answers 404 on every demo route because no demo module is loaded', async () => {
    const server = serverOf(app);
    await request(server).get('/api/probe').expect(200);
    await request(server).get('/api/demo/accounts').expect(404);
    await request(server).get('/api/demo/status').expect(404);
    await request(server).get('/api/demo/scenarios').expect(404);
    await request(server).post('/api/demo/scenarios/clean/stage').expect(404);
    await request(server).post('/api/demo/switch-role').send({ role: 'ADMIN' }).expect(404);
    expect(() => app.get(DemoAccountsService)).toThrow();
  });
});
