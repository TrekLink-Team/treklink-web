// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: never[]) => void;

class FakeSocket {
  handlers = new Map<string, Handler>();
  emitted: [string, unknown][] = [];
  disconnected = false;
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
  receive(event: string, ...args: unknown[]) {
    (this.handlers.get(event) as (...a: unknown[]) => void)(...args);
  }
}

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
  vi.resetModules();
  live = await import('./socketClient');
});

afterEach(() => live.stopLive());

describe('socketClient', () => {
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

  it('passes a new access token to the server as auth.refresh', () => {
    live.startLive(() => 'access-1');
    live.refreshLiveAuth('access-2');
    expect(fake.emitted).toEqual([['auth.refresh', { token: 'access-2' }]]);
  });
});
