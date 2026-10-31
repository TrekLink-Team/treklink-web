// GATEWAY_QUEUE_MAX_ROWS (QUEUE_MAX_ROWS, REQ-STA-03) is validated when the configuration loads, so a
// bad value stops the gateway at start instead of running with a bound nobody chose.
describe('gateway configuration: GATEWAY_QUEUE_MAX_ROWS', () => {
  const original = process.env.GATEWAY_QUEUE_MAX_ROWS;

  afterEach(() => {
    if (original === undefined) delete process.env.GATEWAY_QUEUE_MAX_ROWS;
    else process.env.GATEWAY_QUEUE_MAX_ROWS = original;
  });

  const load = (value: string | undefined) => {
    if (value === undefined) delete process.env.GATEWAY_QUEUE_MAX_ROWS;
    else process.env.GATEWAY_QUEUE_MAX_ROWS = value;
    let maxRows = 0;
    jest.isolateModules(() => {
      // A developer's .env must not decide the default under test.
      jest.doMock('dotenv', () => ({ config: () => ({}) }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      maxRows = (require('./config') as typeof import('./config')).gatewayConfig.queue.maxRows;
    });
    return maxRows;
  };

  it('defaults to 100 000 rows', () => {
    expect(load(undefined)).toBe(100_000);
    expect(load('')).toBe(100_000);
  });

  it('reads a whole number', () => {
    expect(load('500')).toBe(500);
  });

  it.each(['0', '-5', '2.5', 'many', '10000001'])('refuses %s', (value) => {
    expect(() => load(value)).toThrow('GATEWAY_QUEUE_MAX_ROWS');
  });
});
