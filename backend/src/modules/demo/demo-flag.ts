export const DEMO_CONTROLS_FLAG = 'DEMO_CONTROLS_ENABLED';
export const DEMO_TEST_ACCOUNTS_FLAG = 'DEMO_TEST_ACCOUNTS_ENABLED';

const isTrue = (value: string | undefined): boolean =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'true';

// The ConditionalModule condition of AppModule (specs/demo requirements REQ-UBI-01): the demo module is
// loaded only with the true flag and an explicit sandbox/staging application environment.
export const demoControlsEnabled = (env: NodeJS.ProcessEnv): boolean =>
  isTrue(env[DEMO_CONTROLS_FLAG]) &&
  ['sandbox', 'staging'].includes((env.VITE_APP_ENV ?? '').trim().toLowerCase());

// The condition of DemoAccountsModule (REQ-EVT-05, D-089): the read-only test accounts list, independent
// of the control panel flag and of NODE_ENV and the database host.
export const demoTestAccountsEnabled = (env: NodeJS.ProcessEnv): boolean =>
  isTrue(env[DEMO_TEST_ACCOUNTS_FLAG]);

// The condition of DemoSimulationModule (REQ-SIM-01, D-093 amendment): the field simulation routes,
// independent of the control panel flag. The reader lives in gateway-sync, whose simulator reads it too.
export { DEMO_SIMULATION_FLAG, demoSimulationEnabled } from '../gateway-sync';

// W43: simulator controls share the explicit panel gate; the field simulator job keeps its own flag.
export const demoPanelSimulationEnabled = (env: NodeJS.ProcessEnv): boolean =>
  demoControlsEnabled(env) && isTrue(env.DEMO_SIMULATION_ENABLED);
