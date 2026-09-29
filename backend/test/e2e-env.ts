// Boot-time configuration for the e2e suite. ConfigModule validates the environment when AppModule
// is imported (REQ-EVT-01), so the required variables are set before any test file loads. Values
// already present (CI, a developer's shell) win. The suites replace PrismaService with a stub, so
// nothing here is ever connected to.
const E2E_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://e2e:e2e@localhost:5432/treklink_e2e',
  DATABASE_DIRECT_URL: 'postgresql://e2e:e2e@localhost:5432/treklink_e2e',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  JWT_ACCESS_SECRET: 'e2e-access-secret',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret',
};

for (const [name, value] of Object.entries(E2E_DEFAULTS)) {
  process.env[name] ??= value;
}
