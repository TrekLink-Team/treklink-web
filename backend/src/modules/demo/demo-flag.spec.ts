import { demoControlsEnabled, demoTestAccountsEnabled } from './demo-flag';

describe('demoControlsEnabled', () => {
  it.each([
    [{ DEMO_CONTROLS_ENABLED: 'true' }, true],
    [{ DEMO_CONTROLS_ENABLED: ' TRUE ' }, true],
    [{ DEMO_CONTROLS_ENABLED: 'false' }, false],
    [{ DEMO_CONTROLS_ENABLED: '1' }, false],
    [{}, false],
  ])('reads %j as %s', (env, expected) => {
    expect(demoControlsEnabled(env)).toBe(expected);
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
