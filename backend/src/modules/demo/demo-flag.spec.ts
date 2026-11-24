import {
  demoControlsEnabled,
  demoPanelEnabled,
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

describe('demoPanelEnabled (REQ-PNL-01, D-110)', () => {
  const valid = `scrypt:${'ab'.repeat(16)}:${'cd'.repeat(32)}`;

  it('loads the panel only for a hash that parses, whatever the other demo flags say', () => {
    expect(demoPanelEnabled({ DEMO_PANEL_PASSWORD_HASH: valid })).toBe(true);
    expect(
      demoPanelEnabled({
        DEMO_PANEL_PASSWORD_HASH: valid,
        DEMO_CONTROLS_ENABLED: 'false',
        NODE_ENV: 'production',
      }),
    ).toBe(true);
    expect(demoPanelEnabled({})).toBe(false);
    expect(demoPanelEnabled({ DEMO_PANEL_PASSWORD_HASH: '' })).toBe(false);
    expect(demoPanelEnabled({ DEMO_PANEL_PASSWORD_HASH: 'my-plain-password' })).toBe(false);
    expect(demoPanelEnabled({ DEMO_CONTROLS_ENABLED: 'true', VITE_APP_ENV: 'staging' })).toBe(
      false,
    );
  });
});
