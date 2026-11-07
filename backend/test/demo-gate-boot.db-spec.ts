import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
if (
  !databaseUrl ||
  !process.env.DATABASE_DIRECT_URL ||
  ![databaseUrl, process.env.DATABASE_DIRECT_URL].every((value) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname),
  )
)
  throw new Error('Boot regression requires explicit disposable loopback database URLs.');

describe('whole AppModule boot with VITE_APP_ENV unset (W43b)', () => {
  let results: Record<string, { status: number; isSuccess: boolean; statusCode: number }>;
  beforeAll(() => {
    const temporary = mkdtempSync(join(tmpdir(), 'treklink-demo-boot-'));
    const cwd = join(temporary, 'empty');
    mkdirSync(cwd);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      DEMO_CONTROLS_ENABLED: 'true',
      DEMO_SIMULATION_ENABLED: 'true',
      DEMO_TEST_ACCOUNTS_ENABLED: 'false',
      FIELD_SIMULATOR_ENABLED: 'false',
      JOBS_TICK_ON_REQUEST: 'true',
      MQTT_BROKER_URL: 'mqtt://localhost:1883',
      MQTT_INGESTION_ENABLED: 'false',
      JWT_ACCESS_SECRET: 'boot-access-secret',
      JWT_REFRESH_SECRET: 'boot-refresh-secret',
      CHANNEL_KEY_MASTER: 'boot-channel-key-master-not-a-secret-0001',
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://localhost:1025',
      COMPANY_TAX_CODE: '9000000000',
      COMPANY_HOTLINE: '19001234',
      HANDOVER_NOTE_STORE: 'database',
      TS_NODE_PROJECT: join(__dirname, '..', 'tsconfig.json'),
    };
    delete env.VITE_APP_ENV;
    try {
      // The empty child/parent directories prevent local .env files from supplying the missing key.
      const output = execFileSync(
        process.execPath,
        [
          '-r',
          require.resolve('ts-node/register/transpile-only'),
          join(__dirname, 'harness', 'demo-gate-boot.ts'),
        ],
        { cwd, env, encoding: 'utf8', timeout: 60000 },
      );
      const line = output.split('\n').find((value) => value.startsWith('DEMO_BOOT_RESULT='));
      if (!line) throw new Error('Whole-app boot returned no route results.');
      results = JSON.parse(line.slice('DEMO_BOOT_RESULT='.length)) as typeof results;
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 90000);
  it.each(['/api/demo/status', '/api/demo/quick', '/api/demo/simulation'])(
    'omits %s even with both demo flags enabled in production',
    (path) => {
      expect(results[path]).toEqual({ status: 404, isSuccess: false, statusCode: 404 });
    },
  );
});
