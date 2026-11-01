import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { Socket } from 'node:net';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { PriorityTier } from '../config';
import {
  CONTENT_SECURITY_POLICY,
  LOCAL_HOST,
  LocalServer,
  PAGE_DIR,
  PAGE_FILES,
} from './local-server';
import { StationState } from './station-state';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const call = (port: number, path: string, method = 'GET'): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: LOCAL_HOST, port, path, method, headers: { host: `localhost:${port}` } },
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

const read = (file: string) => readFileSync(join(PAGE_DIR, file), 'utf8');

// Every URL the page names: src and href attributes, CSS url(), and the paths the script fetches.
const referencesOf = (html: string, css: string, js: string): string[] => [
  ...[...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((match) => match[1]),
  ...[...css.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((match) => match[1]),
  ...[...js.matchAll(/\bget\('([^']+)'/g)].map((match) => match[1]),
  ...[...js.matchAll(/\bfetch\(\s*'([^']+)'/g)].map((match) => match[1]),
];

describe('Field Station local page (gateway-sync task 5.2)', () => {
  let server: LocalServer;

  beforeEach(async () => {
    const state = new StationState({ staleSeconds: 300, eventLogSize: 50 });
    state.record({
      eventId: '!de000009:1',
      priority: PriorityTier.P0_SOS,
      payload: { sender: '!de000009', type: 'text', payload: { text: 'SOS - [11.5], [108.5]' } },
      heardAt: Date.now(),
    });
    server = new LocalServer({
      state,
      queue: {
        depthByTier: () => [1, 0, 0, 0],
        shedByTier: () => [0, 0, 0, 0],
        oldestEntry: () => null,
      },
      uplink: {
        uplinkStatus: () => ({
          connected: false,
          since: null,
          brokerUrl: 'mqtt://localhost:1883',
          lastError: null,
          lastFlushAt: null,
        }),
      },
      serial: {
        status: () => ({
          port: '/dev/ttyUSB0',
          simulation: true,
          reading: true,
          lastFrameAt: null,
        }),
      },
    });
    await server.listen(0);
  });

  afterEach(async () => {
    await server.close();
  });

  it('serves the page at / with a same-origin-only Content-Security-Policy', async () => {
    const reply = await call(server.port, '/');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(reply.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(reply.body).toContain('<title>TrekLink Field Station</title>');
  });

  it('shows every block the contract lists: nodes, SOS, queue per tier, uplink and the event log', () => {
    const html = read('index.html');
    for (const id of [
      'nodes',
      'sos-banner',
      'depth-P0',
      'depth-P1',
      'depth-P2',
      'depth-P3',
      'queue-oldest',
      'queue-flush',
      'broker-state',
      'serial-state',
      'log',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
  });

  it('names no external asset: every reference is a path on this origin or inline data', () => {
    const refs = referencesOf(read('index.html'), read('page.css'), read('page.js'));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^(\/(?!\/)|data:)/);
    for (const file of ['index.html', 'page.css', 'page.js']) {
      expect(read(file)).not.toMatch(/https?:\/\/|@import|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i);
    }
  });

  it('loads the page and every asset it names, with no connection leaving the loopback', async () => {
    const targets: string[] = [];
    const original = Socket.prototype.connect;
    const spy = jest.spyOn(Socket.prototype, 'connect').mockImplementation(function (
      this: Socket,
      ...args: unknown[]
    ) {
      // Node passes its normalised arguments, `[options, callback]`, as the first argument internally.
      const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
      const options = first as { host?: string; port?: number };
      targets.push(`${options.host}:${options.port}`);
      return (original as (...a: unknown[]) => Socket).apply(this, args);
    });
    try {
      const html = (await call(server.port, '/')).body;
      const refs = referencesOf(html, read('page.css'), read('page.js')).filter((ref) =>
        ref.startsWith('/'),
      );
      const paths = [...new Set(refs.map((ref) => (ref.includes('?') ? `${ref}0` : ref)))];
      const replies = await Promise.all(paths.map((path) => call(server.port, path)));
      replies.forEach((reply, n) => expect([paths[n], reply.status]).toEqual([paths[n], 200]));
      expect(paths).toEqual(
        expect.arrayContaining([
          '/page.css',
          '/page.js',
          '/local/nodes',
          '/local/queue',
          '/local/uplink',
          '/local/events?after=0',
        ]),
      );
    } finally {
      spy.mockRestore();
    }
    expect(new Set(targets)).toEqual(new Set([`${LOCAL_HOST}:${server.port}`]));
  });

  it('serves each asset with its type, answers HEAD and refuses a write', async () => {
    for (const [route, { type }] of Object.entries(PAGE_FILES)) {
      const reply = await call(server.port, route);
      expect([route, reply.status, reply.headers['content-type']]).toEqual([route, 200, type]);
    }
    const head = await call(server.port, '/page.js', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect((await call(server.port, '/', 'POST')).status).toBe(405);
  });

  it('ships a script that parses and writes mesh text as text, never as HTML', () => {
    const js = read('page.js');
    expect(() => new Script(js)).not.toThrow();
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
