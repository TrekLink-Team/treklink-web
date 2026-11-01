import { readFileSync } from 'node:fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { SerialStatus } from '../serial/serial-reader';
import type { StationState } from './station-state';

/** The only address the local page listens on (field-station-local-page.md): never another interface. */
export const LOCAL_HOST = '127.0.0.1';

/** The D-002 envelope, so the same frontend code reads local and cloud responses. */
export interface Envelope<T> {
  result: T;
  isSuccess: boolean;
  statusCode: number;
  message: string;
}

/** What `/local/queue` reads from the queue; `SQLitePriorityQueue` provides it. */
export interface LocalQueueSource {
  depthByTier(): number[];
  shedByTier(): number[];
  oldestEntry(): { capturedAt: number; retryCount: number } | null;
}

/** What `/local/uplink` reads from the MQTT client; `GatewayMqttClient` provides it. */
export interface LocalUplinkSource {
  uplinkStatus(): {
    connected: boolean;
    since: number | null;
    brokerUrl: string;
    lastError: { message: string; at: number } | null;
    lastFlushAt: number | null;
  };
}

export interface LocalSerialSource {
  status(): SerialStatus;
}

export interface LocalSources {
  state: StationState;
  queue: LocalQueueSource;
  uplink: LocalUplinkSource;
  serial: LocalSerialSource;
  /** The station clock; a test pins it. */
  now?: () => number;
}

/**
 * Same-origin only: the browser refuses any script, style, image, font or fetch from another host, so the
 * page cannot make an outbound request even by mistake (NFR-UI-04, works offline).
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
  "font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** One static file of the page, read once at start so a request never touches the disk. */
interface StaticFile {
  body: Buffer;
  type: string;
}

/**
 * The page's folder, `gateway/local-page/`, two folders up from both `src/local` and `dist/local`. The
 * page is plain HTML, CSS and JavaScript with no build step and no external asset (NFR-UI-04).
 */
export const PAGE_DIR = join(__dirname, '..', '..', 'local-page');

/** The page's routes and files; nothing else in the folder is served. */
export const PAGE_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/page.css': { file: 'page.css', type: 'text/css; charset=utf-8' },
  '/page.js': { file: 'page.js', type: 'text/javascript; charset=utf-8' },
};

export function loadPage(dir: string = PAGE_DIR): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  for (const [route, { file, type }] of Object.entries(PAGE_FILES)) {
    files.set(route, { body: readFileSync(join(dir, file)), type });
  }
  return files;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

const byTier = (values: number[]): Record<'P0' | 'P1' | 'P2' | 'P3', number> => ({
  P0: values[0] ?? 0,
  P1: values[1] ?? 0,
  P2: values[2] ?? 0,
  P3: values[3] ?? 0,
});

// The API routes and their handlers; every one reads memory only (the state holder, the queue's SQLite
// file and the clients' own fields), never the network.
type Handler = (sources: LocalSources, url: URL) => Envelope<unknown>;

const ok = <T>(result: T, message: string): Envelope<T> => ({
  result,
  isSuccess: true,
  statusCode: 200,
  message,
});
const fail = (statusCode: number, message: string): Envelope<null> => ({
  result: null,
  isSuccess: false,
  statusCode,
  message,
});

const GET_ROUTES: Record<string, Handler> = {
  '/local/nodes': ({ state, now }) => {
    const nodes = state.nodes((now ?? Date.now)()).map((node) => ({
      nodeId: node.nodeId,
      lastHeardAt: iso(node.lastHeardAt),
      position: node.position && { ...node.position, heardAt: iso(node.position.heardAt) },
      battery: node.battery && { ...node.battery, heardAt: iso(node.battery.heardAt) },
      sosActive: node.sosActive,
      sosKind: node.sosKind,
      lastSosAt: iso(node.lastSosAt),
      stale: node.stale,
    }));
    return ok(nodes, 'Nodes heard by this Field Station');
  },

  '/local/queue': ({ queue, uplink, now }) => {
    const depth = queue.depthByTier();
    const oldest = queue.oldestEntry();
    const at = (now ?? Date.now)();
    return ok(
      {
        depth: byTier(depth),
        total: depth.reduce((sum, value) => sum + value, 0),
        oldest: oldest && {
          capturedAt: iso(oldest.capturedAt),
          ageSeconds: Math.max(0, Math.floor((at - oldest.capturedAt) / 1000)),
          retryCount: oldest.retryCount,
        },
        lastFlushAt: iso(uplink.uplinkStatus().lastFlushAt),
        shed: byTier(queue.shedByTier()),
      },
      'Local queue',
    );
  },

  '/local/uplink': ({ uplink, serial }) => {
    const broker = uplink.uplinkStatus();
    const port = serial.status();
    return ok(
      {
        broker: {
          connected: broker.connected,
          since: iso(broker.since),
          url: broker.brokerUrl,
          lastError: broker.lastError && {
            message: broker.lastError.message,
            at: iso(broker.lastError.at),
          },
        },
        serial: { ...port, lastFrameAt: iso(port.lastFrameAt) },
      },
      'Uplink and serial port',
    );
  },

  '/local/events': ({ state }, url) => {
    const raw = url.searchParams.get('after');
    const after = raw === null || raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(after) || after < 0) {
      return fail(400, 'after must be a whole number of at least 0');
    }
    const events = state.events(after).map((event) => ({ ...event, heardAt: iso(event.heardAt) }));
    return ok({ events, lastSeq: state.lastSeq() }, 'Recent events');
  },
};

/**
 * The page is reached only as `127.0.0.1:<port>` or `localhost:<port>`. Any other Host header is refused,
 * so a web page the operator opens elsewhere cannot read the station through DNS rebinding.
 */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  return host === `${LOCAL_HOST}:${port}` || host === `localhost:${port}`;
}

export class LocalServer {
  private server: Server | null = null;
  private boundPort = 0;

  private readonly page: Map<string, StaticFile>;

  constructor(
    private readonly sources: LocalSources,
    pageDir: string = PAGE_DIR,
  ) {
    this.page = loadPage(pageDir);
  }

  /** The port actually bound, which differs from the one asked for only when that was 0 (tests). */
  public get port(): number {
    return this.boundPort;
  }

  /** The address actually bound, or null before `listen()`. */
  public address(): AddressInfo | null {
    return this.server ? (this.server.address() as AddressInfo) : null;
  }

  public listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(port, LOCAL_HOST, () => {
        server.off('error', reject);
        this.boundPort = (server.address() as AddressInfo).port;
        this.server = server;
        resolve(this.boundPort);
      });
    });
  }

  public close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  public handle(req: IncomingMessage, res: ServerResponse): void {
    const common = {
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    };
    const json = (body: Envelope<unknown>) => {
      res.writeHead(body.statusCode, {
        ...common,
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(body));
    };

    if (!hostAllowed(req.headers.host, this.boundPort)) {
      json(fail(403, `Open the page as http://localhost:${this.boundPort}`));
      return;
    }
    // A malformed request target (`//`, for one) makes `new URL` throw; answer 400 instead of letting the
    // exception reach the event loop, where nothing catches it and the station would stop.
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${LOCAL_HOST}:${this.boundPort}`);
    } catch {
      json(fail(400, 'The request path is not valid'));
      return;
    }
    const method = req.method ?? 'GET';

    const file = this.page.get(url.pathname);
    if (file) {
      if (method !== 'GET' && method !== 'HEAD') {
        return json(fail(405, `${method} is not allowed here`));
      }
      res.writeHead(200, {
        ...common,
        'Content-Type': file.type,
        'Content-Length': file.body.length,
      });
      res.end(method === 'HEAD' ? undefined : file.body);
      return;
    }

    if (url.pathname === '/local/config') {
      // The contract's configuration form is not built yet: the station reads its configuration from the
      // environment (`.env`) at start. Nothing is stored and nothing reaches the broker.
      if (method !== 'PUT') return json(fail(405, `${method} is not allowed here`));
      return json(
        fail(501, 'Configuration from the page is not available yet; set it in the .env file'),
      );
    }

    const route = GET_ROUTES[url.pathname];
    if (!route) return json(fail(404, `No local route ${url.pathname}`));
    if (method !== 'GET') return json(fail(405, `${method} is not allowed here`));
    try {
      json(route(this.sources, url));
    } catch (err) {
      json(fail(500, `Local state could not be read: ${(err as Error).message}`));
    }
  }
}
