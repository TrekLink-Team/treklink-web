import { demoControlsEnabled } from './demo-flag';

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
