import { request } from 'node:http';
import { createServer, Socket } from 'node:net';
import { TestBroker, waitFor } from '../../test/support/broker';
import { PriorityTier } from '../config';
import { GatewayMqttClient } from '../mqtt/mqtt-client';
import { SQLitePriorityQueue } from '../queue/priority-queue';
import { SerialFrameReader } from '../serial/serial-reader';
import { LOCAL_HOST, LocalServer, LocalSources } from './local-server';
import { StationState } from './station-state';

const T0 = Date.UTC(2026, 10, 1, 5, 0, 0);
const silent = { warn: () => undefined, error: () => undefined };

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const call = (
  port: number,
  path: string,
  options: { method?: string; host?: string } = {},
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: LOCAL_HOST,
        port,
        path,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? `localhost:${port}` },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });

const json = (reply: Reply) =>
  JSON.parse(reply.body) as {
    result: never;
    isSuccess: boolean;
    statusCode: number;
    message: string;
  };

// A port nothing listens on: the broker of a station whose uplink is down.
const closedPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, LOCAL_HOST, () => resolve()));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

describe('Field Station local API (gateway-sync task 5.2)', () => {
  const servers: LocalServer[] = [];
  const start = async (sources: LocalSources) => {
    const server = new LocalServer(sources);
    servers.push(server);
    await server.listen(0);
    return server;
  };

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
  });

  const stubSources = (): LocalSources => {
    const state = new StationState({ staleSeconds: 300, eventLogSize: 50 });
    state.record({
      eventId: '!de000009:1',
      priority: PriorityTier.P2_GPS,
      payload: {
        sender: '!de000009',
        type: 'position',
        payload: { latitude_i: 115544000, longitude_i: 1085381000, altitude: 1310 },
      },
      heardAt: T0,
    });
    state.record({
      eventId: '!de000009:2',
      priority: PriorityTier.P3_TELEMETRY,
      payload: {
        sender: '!de000009',
        type: 'telemetry',
        payload: { battery_level: 82, voltage: 4.0 },
      },
      heardAt: T0 + 1000,
    });
    state.record({
      eventId: '!de00000a:3',
      priority: PriorityTier.P0_SOS,
      payload: {
        sender: '!de00000a',
        type: 'text',
        payload: { text: 'SOS - [11.554400], [108.538100]' },
      },
      heardAt: T0 + 2000,
    });
    return {
      state,
      queue: {
        depthByTier: () => [1, 0, 4, 7],
        shedByTier: () => [0, 0, 2, 5],
        oldestEntry: () => ({ capturedAt: T0 - 90_000, retryCount: 3 }),
      },
      uplink: {
        uplinkStatus: () => ({
          connected: false,
          since: T0 - 120_000,
          brokerUrl: 'mqtts://mqtt.treklink.vn:8883',
          lastError: { message: 'connect ECONNREFUSED', at: T0 - 5_000 },
          lastFlushAt: T0 - 130_000,
        }),
      },
      serial: {
        status: () => ({
          port: '/dev/ttyUSB0',
          simulation: true,
          reading: true,
          lastFrameAt: T0 + 2000,
        }),
      },
      now: () => T0 + 10_000,
    };
  };

  it('binds to 127.0.0.1 only', async () => {
    const server = await start(stubSources());
    expect(server.address()?.address).toBe('127.0.0.1');
  });

  it('GET /local/nodes returns every node heard in the envelope, SOS first', async () => {
    const server = await start(stubSources());
    const reply = await call(server.port, '/local/nodes');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toContain('application/json');
    expect(json(reply)).toEqual({
      isSuccess: true,
      statusCode: 200,
      message: 'Nodes heard by this Field Station',
      result: [
        {
          nodeId: '!de00000a',
          lastHeardAt: '2026-11-01T05:00:02.000Z',
          position: null,
          battery: null,
          sosActive: true,
          sosKind: 'SOS',
          lastSosAt: '2026-11-01T05:00:02.000Z',
          stale: false,
        },
        {
          nodeId: '!de000009',
          lastHeardAt: '2026-11-01T05:00:01.000Z',
          position: {
            latitude: 11.5544,
            longitude: 108.5381,
            altitude: 1310,
            heardAt: '2026-11-01T05:00:00.000Z',
          },
          battery: { level: 82, voltage: 4.0, heardAt: '2026-11-01T05:00:01.000Z' },
          sosActive: false,
          sosKind: null,
          lastSosAt: null,
          stale: false,
        },
      ],
    });
  });

  it('GET /local/queue returns depth per tier, the oldest entry, the last flush and the shed counts', async () => {
    const server = await start(stubSources());
    expect(json(await call(server.port, '/local/queue')).result).toEqual({
      depth: { P0: 1, P1: 0, P2: 4, P3: 7 },
      total: 12,
      oldest: { capturedAt: '2026-11-01T04:58:30.000Z', ageSeconds: 100, retryCount: 3 },
      lastFlushAt: '2026-11-01T04:57:50.000Z',
      shed: { P0: 0, P1: 0, P2: 2, P3: 5 },
    });
  });

  it('GET /local/queue answers an empty queue with no oldest entry', async () => {
    const sources = stubSources();
    sources.queue = {
      depthByTier: () => [0, 0, 0, 0],
      shedByTier: () => [0, 0, 0, 0],
      oldestEntry: () => null,
    };
    const server = await start(sources);
    expect(json(await call(server.port, '/local/queue')).result).toMatchObject({
      total: 0,
      oldest: null,
    });
  });

  it('GET /local/uplink returns the broker state, the last error and the serial port', async () => {
    const server = await start(stubSources());
    expect(json(await call(server.port, '/local/uplink')).result).toEqual({
      broker: {
        connected: false,
        since: '2026-11-01T04:58:00.000Z',
        url: 'mqtts://mqtt.treklink.vn:8883',
        lastError: { message: 'connect ECONNREFUSED', at: '2026-11-01T04:59:55.000Z' },
      },
      serial: {
        port: '/dev/ttyUSB0',
        simulation: true,
        reading: true,
        lastFrameAt: '2026-11-01T05:00:02.000Z',
      },
    });
  });

  it('GET /local/events returns the events after a sequence, newest last', async () => {
    const server = await start(stubSources());
    const all = json(await call(server.port, '/local/events')).result as {
      events: { localSeq: number }[];
      lastSeq: number;
    };
    expect(all.events.map((event) => event.localSeq)).toEqual([1, 2, 3]);
    expect(all.lastSeq).toBe(3);
    const after = json(await call(server.port, '/local/events?after=2')).result as {
      events: unknown[];
    };
    expect(after.events).toEqual([
      {
        localSeq: 3,
        eventId: '!de00000a:3',
        nodeId: '!de00000a',
        kind: 'SOS',
        tier: 0,
        heardAt: '2026-11-01T05:00:02.000Z',
        summary: 'SOS - [11.554400], [108.538100]',
      },
    ]);
  });

  it.each(['-1', '1.5', 'abc'])('GET /local/events refuses after=%s with 400', async (after) => {
    const server = await start(stubSources());
    const reply = await call(server.port, `/local/events?after=${after}`);
    expect(reply.status).toBe(400);
    expect(json(reply)).toMatchObject({ isSuccess: false, statusCode: 400, result: null });
  });

  it('answers PUT /local/config with 501 until the configuration form is built', async () => {
    const server = await start(stubSources());
    const reply = await call(server.port, '/local/config', { method: 'PUT' });
    expect(reply.status).toBe(501);
    expect(json(reply).isSuccess).toBe(false);
    expect((await call(server.port, '/local/config')).status).toBe(405);
  });

  it('answers an unknown route with 404 and a wrong method with 405, in the envelope', async () => {
    const server = await start(stubSources());
    const missing = await call(server.port, '/local/nothing');
    expect(missing.status).toBe(404);
    expect(json(missing)).toMatchObject({ isSuccess: false, statusCode: 404 });
    expect((await call(server.port, '/local/nodes', { method: 'POST' })).status).toBe(405);
  });

  it('refuses a request whose Host is not the local page (DNS rebinding)', async () => {
    const server = await start(stubSources());
    expect(
      (await call(server.port, '/local/nodes', { host: `evil.example:${server.port}` })).status,
    ).toBe(403);
    expect(
      (await call(server.port, '/local/nodes', { host: `127.0.0.1:${server.port}` })).status,
    ).toBe(200);
  });

  it('answers 400 to a malformed request path and keeps serving (review of #239)', async () => {
    const server = await start(stubSources());
    for (const path of ['//', '///']) {
      const reply = await call(server.port, path);
      expect(reply.status).toBe(400);
      expect(json(reply)).toMatchObject({ isSuccess: false, statusCode: 400 });
    }
    expect((await call(server.port, '/local/nodes')).status).toBe(200);
  });

  it('answers 500 in the envelope when a source throws', async () => {
    const sources = stubSources();
    sources.queue.depthByTier = () => {
      throw new Error('database is locked');
    };
    const server = await start(sources);
    const reply = await call(server.port, '/local/queue');
    expect(reply.status).toBe(500);
    expect(json(reply).message).toContain('database is locked');
  });
});

describe('Field Station local API with the uplink down (REQ-STA-02)', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  // The real queue, MQTT client and reader, wired as index.ts wires them.
  const station = async (brokerUrl: string) => {
    const queue = new SQLitePriorityQueue(':memory:', { logger: silent });
    cleanups.push(() => queue.close());
    const mqttClient = new GatewayMqttClient(
      brokerUrl,
      queue,
      { username: '', secret: '' },
      { reconnectPeriodMs: 200 },
    );
    cleanups.push(() => mqttClient.disconnect());
    const state = new StationState({ staleSeconds: 300, eventLogSize: 50 });
    const reader = new SerialFrameReader(
      { port: '/dev/ttyUSB0', baudRate: 115200, simulationMode: true },
      queue,
      () => mqttClient.flushQueue(),
      (frame) => state.record(frame),
    );
    const server = new LocalServer({ state, queue, uplink: mqttClient, serial: reader });
    await server.listen(0);
    cleanups.push(() => server.close());
    mqttClient.connect();
    return { queue, mqttClient, reader, server };
  };

  const hear = (reader: SerialFrameReader, n: number, type: 'position' | 'text') =>
    reader.handleFrame(
      '!de000009',
      '3724541961',
      n,
      type === 'text' ? PriorityTier.P0_SOS : PriorityTier.P2_GPS,
      {
        id: n,
        sender: '!de000009',
        type,
        payload:
          type === 'text'
            ? { text: 'SOS - [11.5], [108.5]' }
            : { latitude_i: 115544000, longitude_i: 1085381000 },
      },
    );

  it('answers every route while the broker is unreachable, with no request leaving the loopback', async () => {
    const { mqttClient, reader, server } = await station(
      `mqtt://${LOCAL_HOST}:${await closedPort()}`,
    );
    await waitFor(
      () => mqttClient.uplinkStatus().lastError !== null,
      5_000,
      'the refused connection',
    );
    hear(reader, 1, 'position');
    hear(reader, 2, 'text');

    // Record every outbound TCP connection the process opens while the page is read. The MQTT client's
    // reconnect attempts go to the broker port; the requests themselves must open nothing but the
    // test's own connection to the local page.
    const targets: string[] = [];
    const original = Socket.prototype.connect;
    const spy = jest.spyOn(Socket.prototype, 'connect').mockImplementation(function (
      this: Socket,
      ...args: unknown[]
    ) {
      // Node passes its normalised arguments, `[options, callback]`, as the first argument internally.
      const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
      const options = first as { host?: string; port?: number } | number;
      targets.push(
        typeof options === 'object' ? `${options.host}:${options.port}` : `?:${options}`,
      );
      return (original as (...a: unknown[]) => Socket).apply(this, args);
    });
    try {
      const replies = await Promise.all(
        ['/local/nodes', '/local/queue', '/local/uplink', '/local/events'].map((path) =>
          call(server.port, path),
        ),
      );
      expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200, 200]);
      const [nodes, queue, uplink] = replies.map(
        (reply) => json(reply).result as Record<string, unknown>,
      );
      expect(nodes).toEqual([expect.objectContaining({ nodeId: '!de000009', sosActive: true })]);
      expect(queue).toMatchObject({
        depth: { P0: 1, P1: 0, P2: 1, P3: 0 },
        total: 2,
        oldest: { retryCount: 0 },
      });
      expect(uplink).toMatchObject({
        broker: { connected: false, lastError: { message: expect.any(String) } },
      });
    } finally {
      spy.mockRestore();
    }
    const pagePort = `${LOCAL_HOST}:${server.port}`;
    const brokerPort = new URL(mqttClient.uplinkStatus().brokerUrl).port;
    expect(
      targets.filter((target) => target !== pagePort && !target.endsWith(`:${brokerPort}`)),
    ).toEqual([]);
    expect(targets.filter((target) => target === pagePort)).toHaveLength(4);
  });

  it('keeps answering when the uplink drops, and shows it down', async () => {
    const broker = new TestBroker();
    await broker.start();
    cleanups.push(() => broker.stop());
    const { mqttClient, reader, server } = await station(broker.url);
    await waitFor(() => mqttClient.connected, 5_000, 'the first connection');
    expect(
      (json(await call(server.port, '/local/uplink')).result as { broker: { connected: boolean } })
        .broker.connected,
    ).toBe(true);

    await broker.stop();
    await waitFor(() => !mqttClient.connected, 5_000, 'the drop');
    hear(reader, 3, 'text');

    const uplink = json(await call(server.port, '/local/uplink')).result as {
      broker: { connected: boolean; since: string };
    };
    expect(uplink.broker.connected).toBe(false);
    expect(Date.parse(uplink.broker.since)).toBeGreaterThan(0);
    const queue = json(await call(server.port, '/local/queue')).result as {
      depth: Record<string, number>;
    };
    expect(queue.depth.P0).toBe(1);
  });
});
