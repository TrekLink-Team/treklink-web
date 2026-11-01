// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: never[]) => void;

class FakeSocket {
  handlers = new Map<string, Handler>();
  emitted: [string, unknown][] = [];
  disconnected = false;
  connected = false;
  active = true;
  connectCalls = 0;
  constructor(
    public url: string,
    public options: { auth: (send: (data: object) => void) => void },
  ) {}
  on(event: string, handler: Handler) {
    this.handlers.set(event, handler);
    return this;
  }
  emit(event: string, body: unknown) {
    this.emitted.push([event, body]);
  }
  disconnect() {
    this.disconnected = true;
  }
  connect() {
    this.connectCalls += 1;
  }
  receive(event: string, ...args: unknown[]) {
    (this.handlers.get(event) as (...a: unknown[]) => void)(...args);
  }
}

const apiClient = vi.fn((path: string) => Promise.resolve({ path }));
vi.mock('../api/apiClient', () => ({ apiClient: (path: string) => apiClient(path) }));

let fake: FakeSocket;
vi.mock('socket.io-client', () => ({
  io: (url: string, options: FakeSocket['options']) => {
    fake = new FakeSocket(url, options);
    return fake;
  },
}));

const entry = (seq: number, type = 'device.position') => ({
  seq,
  type,
  payload: {},
  createdAt: '2026-10-24T03:15:00.000Z',
});

const handshake = (): object => {
  let sent: object = {};
  fake.options.auth((data) => {
    sent = data;
  });
  return sent;
};

let live: typeof import('./socketClient');

beforeEach(async () => {
  sessionStorage.clear();
  apiClient.mockClear();
  vi.resetModules();
  live = await import('./socketClient');
});

afterEach(() => {
  live.stopLive();
  vi.unstubAllEnvs();
});

describe('socketClient', () => {
  it('opens no socket and never pauses in poll mode (Vercel, D-089)', () => {
    vi.stubEnv('VITE_LIVE_MODE', 'poll');
    const before = fake;
    const messages: string[] = [];
    live.subscribeLive((message) => messages.push(message.kind));
    live.startLive(() => 'access-1');
    expect(live.livePolls()).toBe(true);
    expect(fake).toBe(before);
    expect(live.isLivePaused()).toBe(false);
    expect(messages).toEqual([]);
  });

  it('connects to /live with the token and no cursor on first connect', () => {
    live.startLive(() => 'access-1');
    expect(fake.url).toMatch(/\/live$/);
    expect(handshake()).toEqual({ token: 'access-1', after: undefined });
  });

  it('keeps the last cursor, resends it on reconnect and drops duplicates', () => {
    const seen: number[] = [];
    live.subscribeLive((message) => message.kind === 'entry' && seen.push(message.entry.seq));
    live.startLive(() => 'access-1');
    fake.receive('stream', entry(10));
    fake.receive('stream', entry(11));
    fake.receive('stream', entry(11));
    fake.receive('stream', entry(9));
    expect(seen).toEqual([10, 11]);
    expect(sessionStorage.getItem('treklink.live.cursor')).toBe('11');
    expect(handshake()).toEqual({ token: 'access-1', after: 11 });
  });

  it('delivers a personal incident.alert (seq 0) without reading or moving the cursor', () => {
    const types: string[] = [];
    live.subscribeLive((message) => message.kind === 'entry' && types.push(message.entry.type));
    live.startLive(() => 'access-1');
    fake.receive('stream', entry(10));
    fake.receive('stream', entry(0, 'incident.alert'));
    fake.receive('stream', entry(0, 'incident.alert'));
    expect(types).toEqual(['device.position', 'incident.alert', 'incident.alert']);
    expect(sessionStorage.getItem('treklink.live.cursor')).toBe('10');
  });

  it('is paused from disconnect until replay.done (MSG32)', () => {
    const states: boolean[] = [];
    live.subscribeLive((message) => message.kind === 'paused' && states.push(message.paused));
    live.startLive(() => 'access-1');
    fake.receive('stream', entry(5));
    fake.receive('disconnect');
    fake.receive('connect');
    expect(live.isLivePaused()).toBe(true);
    fake.receive('stream', entry(0, 'replay.done'));
    expect(live.isLivePaused()).toBe(false);
    expect(states).toEqual([true, false]);
  });

  it('does not wait for a replay when it reconnects without a cursor', () => {
    live.startLive(() => 'access-1');
    fake.receive('disconnect');
    expect(live.isLivePaused()).toBe(true);
    fake.receive('connect');
    expect(live.isLivePaused()).toBe(false);
  });

  it('forgets the cursor on replay.expired and announces it', () => {
    const kinds: string[] = [];
    live.subscribeLive((message) => kinds.push(message.kind));
    live.startLive(() => 'access-1');
    fake.receive('stream', entry(5));
    fake.receive('stream', entry(0, 'replay.expired'));
    expect(sessionStorage.getItem('treklink.live.cursor')).toBeNull();
    expect(kinds).toContain('replay.expired');
  });

  it('keeps streaming without a cursor when session storage is unavailable', () => {
    const seen: number[] = [];
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      live.subscribeLive((message) => message.kind === 'entry' && seen.push(message.entry.seq));
      live.startLive(() => 'access-1');
      fake.receive('stream', entry(3));
      expect(seen).toEqual([3]);
      expect(handshake()).toEqual({ token: 'access-1', after: undefined });
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('passes a new access token to the server as auth.refresh', () => {
    live.startLive(() => 'access-1');
    fake.connected = true;
    live.refreshLiveAuth('access-2');
    expect(fake.emitted).toEqual([['auth.refresh', { token: 'access-2' }]]);
    expect(fake.connectCalls).toBe(0);
  });

  it('stores the cursor of replay.done so an empty replay still advances it', () => {
    live.startLive(() => 'access-1');
    fake.receive('stream', { ...entry(0, 'replay.done'), cursor: 42 });
    expect(sessionStorage.getItem('treklink.live.cursor')).toBe('42');
  });

  it('recovers from a refused handshake: probes the API once, then reconnects with the new token', () => {
    live.startLive(() => 'access-1');
    fake.receive('stream', entry(7));
    fake.active = false;
    fake.receive('disconnect', 'io server disconnect');
    fake.receive('connect_error', new Error('UNAUTHENTICATED'));
    fake.receive('connect_error', new Error('UNAUTHENTICATED'));
    expect(live.isLivePaused()).toBe(true);
    expect(apiClient).toHaveBeenCalledOnce();
    expect(apiClient).toHaveBeenCalledWith('/auth/me');

    live.refreshLiveAuth('access-2');
    expect(fake.connectCalls).toBe(1);
    fake.active = true;
    fake.receive('connect');
    expect(live.isLivePaused()).toBe(true);
    fake.receive('stream', { ...entry(0, 'replay.done'), cursor: 9 });
    expect(live.isLivePaused()).toBe(false);
  });

  it('probes the API again after a connection succeeded and was refused later', () => {
    live.startLive(() => 'access-1');
    fake.active = false;
    fake.receive('connect_error', new Error('UNAUTHENTICATED'));
    fake.receive('connect');
    fake.receive('disconnect', 'io server disconnect');
    expect(apiClient).toHaveBeenCalledTimes(2);
  });

  it('leaves automatic reconnection alone while socket.io is still retrying', () => {
    live.startLive(() => 'access-1');
    fake.receive('connect_error', new Error('xhr poll error'));
    live.refreshLiveAuth('access-2');
    expect(apiClient).not.toHaveBeenCalled();
    expect(fake.connectCalls).toBe(0);
  });
});
