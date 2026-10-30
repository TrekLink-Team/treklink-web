// Boot-time configuration for the test:db suites that compile AppModule against the disposable
// database. ConfigModule validates the environment when AppModule is imported, so this file is
// imported first. DATABASE_URL and DATABASE_DIRECT_URL must already be explicit (test/README.md);
// MQTT ingestion stays off and nothing connects to a broker; signed handover notes go to the system
// temporary directory instead of the checkout.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB_APP_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  MQTT_INGESTION_ENABLED: 'false',
  JWT_ACCESS_SECRET: 'db-access-secret',
  JWT_REFRESH_SECRET: 'db-refresh-secret',
  MAIL_TRANSPORT: 'console',
  HANDOVER_NOTE_STORAGE_DIR: join(tmpdir(), 'treklink-test-db-handover-notes'),
  SEPAY_WEBHOOK_API_KEY: 'db-sepay-webhook-key',
};

for (const [name, value] of Object.entries(DB_APP_DEFAULTS)) {
  process.env[name] ??= value;
}
