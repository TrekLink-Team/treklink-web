export const DEMO_CONTROLS_FLAG = 'DEMO_CONTROLS_ENABLED';
export const DEMO_TEST_ACCOUNTS_FLAG = 'DEMO_TEST_ACCOUNTS_ENABLED';

const isTrue = (value: string | undefined): boolean =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'true';

// The ConditionalModule condition of AppModule (specs/demo requirements REQ-UBI-01): the demo module is
// loaded only when the variable reads `true`; unset, `false` or anything else leaves it out.
export const demoControlsEnabled = (env: NodeJS.ProcessEnv): boolean =>
  isTrue(env[DEMO_CONTROLS_FLAG]);

// The condition of DemoAccountsModule (REQ-EVT-05, D-089): the read-only test accounts list, independent
// of the control panel flag and of NODE_ENV and the database host.
export const demoTestAccountsEnabled = (env: NodeJS.ProcessEnv): boolean =>
  isTrue(env[DEMO_TEST_ACCOUNTS_FLAG]);
