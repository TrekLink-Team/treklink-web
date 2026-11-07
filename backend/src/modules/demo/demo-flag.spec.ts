import {
  demoControlsEnabled,
  demoPanelSimulationEnabled,
  demoTestAccountsEnabled,
} from './demo-flag';

describe('demoControlsEnabled', () => {
  it.each([
    [{ DEMO_CONTROLS_ENABLED: 'true' }, true],
    [{ DEMO_CONTROLS_ENABLED: ' TRUE ' }, true],
    [{ DEMO_CONTROLS_ENABLED: 'false' }, false],
    [{ DEMO_CONTROLS_ENABLED: '1' }, false],
    [{}, false],
  ])('reads %j as %s', (env, expected) => {
    expect(demoControlsEnabled({ VITE_APP_ENV: 'sandbox', ...env })).toBe(expected);
  });
});

describe('demoTestAccountsEnabled (D-089)', () => {
  it.each([
    [{ DEMO_TEST_ACCOUNTS_ENABLED: 'true' }, true],
    [{ DEMO_TEST_ACCOUNTS_ENABLED: 'false' }, false],
    [{ DEMO_CONTROLS_ENABLED: 'true' }, false],
    [{}, false],
  ])('reads %j as %s, independently of the control panel flag', (env, expected) => {
    expect(demoTestAccountsEnabled(env)).toBe(expected);
  });
});

describe('W43 simulation panel gate', () => {
  it.each([
    [
      { DEMO_CONTROLS_ENABLED: 'true', VITE_APP_ENV: 'staging', DEMO_SIMULATION_ENABLED: 'true' },
      true,
    ],
    [
      { DEMO_CONTROLS_ENABLED: 'false', VITE_APP_ENV: 'staging', DEMO_SIMULATION_ENABLED: 'true' },
      false,
    ],
    [
      {
        DEMO_CONTROLS_ENABLED: 'true',
        VITE_APP_ENV: 'production',
        DEMO_SIMULATION_ENABLED: 'true',
      },
      false,
    ],
    [{ DEMO_CONTROLS_ENABLED: 'true', DEMO_SIMULATION_ENABLED: 'true' }, false],
    [
      { DEMO_CONTROLS_ENABLED: 'true', VITE_APP_ENV: 'staging', DEMO_SIMULATION_ENABLED: 'false' },
      false,
    ],
  ])('loads only for the explicit control gate and simulator flag: %j', (env, expected) =>
    expect(demoPanelSimulationEnabled(env)).toBe(expected),
  );
});
