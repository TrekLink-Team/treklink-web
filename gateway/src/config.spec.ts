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

// The local page settings (gateway-sync task 5.2) are validated the same way.
describe('gateway configuration: the local page', () => {
  const names = ['GATEWAY_LOCAL_PORT', 'GATEWAY_LOCAL_STALE_SECONDS', 'GATEWAY_LOCAL_EVENT_LOG_SIZE'] as const;
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });

  const load = (values: Partial<Record<(typeof names)[number], string>>) => {
    for (const name of names) {
      if (values[name] === undefined) delete process.env[name];
      else process.env[name] = values[name];
    }
    let local: { port: number; staleSeconds: number; eventLogSize: number } | undefined;
    jest.isolateModules(() => {
      jest.doMock('dotenv', () => ({ config: () => ({}) }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      local = (require('./config') as typeof import('./config')).gatewayConfig.local;
    });
    return local!;
  };

  it('defaults to port 4321, 300 s stale and 200 events', () => {
    expect(load({})).toEqual({ port: 4321, staleSeconds: 300, eventLogSize: 200 });
  });

  it('reads the values from the environment', () => {
    expect(load({ GATEWAY_LOCAL_PORT: '8080', GATEWAY_LOCAL_STALE_SECONDS: '60', GATEWAY_LOCAL_EVENT_LOG_SIZE: '20' })).toEqual({
      port: 8080,
      staleSeconds: 60,
      eventLogSize: 20,
    });
  });

  it.each(['0', '65536', '43.21', 'http'])('refuses GATEWAY_LOCAL_PORT=%s', (value) => {
    expect(() => load({ GATEWAY_LOCAL_PORT: value })).toThrow('GATEWAY_LOCAL_PORT');
  });

  it.each(['29', '7201'])('refuses GATEWAY_LOCAL_STALE_SECONDS=%s', (value) => {
    expect(() => load({ GATEWAY_LOCAL_STALE_SECONDS: value })).toThrow('GATEWAY_LOCAL_STALE_SECONDS');
  });

  it.each(['9', '10001'])('refuses GATEWAY_LOCAL_EVENT_LOG_SIZE=%s', (value) => {
    expect(() => load({ GATEWAY_LOCAL_EVENT_LOG_SIZE: value })).toThrow('GATEWAY_LOCAL_EVENT_LOG_SIZE');
  });
});
