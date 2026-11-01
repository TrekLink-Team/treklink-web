export const DEMO_CONTROLS_FLAG = 'DEMO_CONTROLS_ENABLED';

// The ConditionalModule condition of AppModule (specs/demo requirements REQ-UBI-01): the demo module is
// loaded only when the variable reads `true`; unset, `false` or anything else leaves it out.
export const demoControlsEnabled = (env: NodeJS.ProcessEnv): boolean =>
  String(env[DEMO_CONTROLS_FLAG] ?? '')
    .trim()
    .toLowerCase() === 'true';
