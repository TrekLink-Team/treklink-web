import { io, type Socket } from 'socket.io-client';
import { apiClient } from '../api/apiClient';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';
const CURSOR_KEY = 'treklink.live.cursor';

// Live mode, set at build time (frontend design §3). `poll` is for a host that cannot keep a socket:
// Vercel Functions hold no WebSocket and spread Socket.IO polling over instances (D-089). No socket is
// opened, MSG32 never shows, and LiveProvider refetches the stream-driven views every LIVE_POLL_MS.
export const LIVE_POLL_MS = 15_000;
export const livePolls = (): boolean => import.meta.env.VITE_LIVE_MODE === 'poll';

// One entry of the stream (monitoring ws-live-contract). A push and a REST replay carry this shape.
export interface LiveEntry {
  seq: number;
  /** Only on `replay.done`: the cursor to resume from. */
  cursor?: number;
  type: string;
  /** Null when the entry names no device, as an `incident.changed` stored before monitoring added it. */
  deviceId?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type LiveMessage =
  | { kind: 'entry'; entry: LiveEntry }
  | { kind: 'replay.done' }
  | { kind: 'replay.expired' }
  | { kind: 'paused'; paused: boolean };

type Listener = (message: LiveMessage) => void;

let socket: Socket | null = null;
let getAccessToken: () => string | null = () => null;
let paused = false;
// One recovery attempt per refusal, so a server that keeps refusing is not retried in a tight loop.
let recovering = false;
const listeners = new Set<Listener>();

const emit = (message: LiveMessage): void => listeners.forEach((listener) => listener(message));

const setPaused = (next: boolean): void => {
  if (paused === next) return;
  paused = next;
  emit({ kind: 'paused', paused });
};

// The cursor lives in sessionStorage so a reload resumes the stream; it can be unavailable, and the
// client then reconnects without a cursor.
const readCursor = (): number | undefined => {
  try {
    const stored = sessionStorage.getItem(CURSOR_KEY);
    const cursor = stored === null ? NaN : Number(stored);
    return Number.isFinite(cursor) ? cursor : undefined;
  } catch {
    return undefined;
  }
};

const writeCursor = (seq: number | null): void => {
  try {
    if (seq === null) sessionStorage.removeItem(CURSOR_KEY);
    else sessionStorage.setItem(CURSOR_KEY, String(seq));
  } catch {
    // The stream still works without a stored cursor.
  }
};

export const subscribeLive = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isLivePaused = (): boolean => paused;

// Opens the single socket to `/live` (ws-live-contract). The handshake is computed per attempt, so a
// reconnect carries the latest token and the last cursor.
export const startLive = (tokenSource: () => string | null): void => {
  getAccessToken = tokenSource;
  if (socket || livePolls()) return;

  socket = io(`${WS_URL}/live`, {
    auth: (send) => send({ token: getAccessToken(), after: readCursor() }),
    reconnectionDelay: 2000,
  });

  // socket.io does not retry a refused handshake or a close ordered by the server; it waits for
  // connect() to be called. Asking the API for `me` makes the API client refresh an expired token,
  // and the new token reaches refreshLiveAuth, which reconnects. MSG32 stays up meanwhile.
  const recover = (): void => {
    if (recovering) return;
    recovering = true;
    void apiClient('/auth/me').catch(() => undefined);
  };
  socket.on('connect_error', () => {
    setPaused(true);
    if (socket && !socket.active) recover();
  });

  socket.on('connect', () => {
    recovering = false;
    // Without a cursor the server sends no replay, so there is nothing to wait for.
    if (readCursor() === undefined) setPaused(false);
  });
  socket.on('disconnect', (reason: string) => {
    setPaused(true);
    if (reason === 'io server disconnect') recover();
  });
  socket.on('stream', (entry: LiveEntry) => {
    if (entry.type === 'replay.done') {
      if (typeof entry.cursor === 'number') writeCursor(entry.cursor);
      setPaused(false);
      emit({ kind: 'replay.done' });
      return;
    }
    if (entry.type === 'replay.expired') {
      writeCursor(null);
      setPaused(false);
      emit({ kind: 'replay.expired' });
      return;
    }
    // A personal incident alert is not a stored stream entry: it carries seq 0 and neither reads nor
    // moves the replay cursor (incidents design §3). A missed one stays in the incident queue.
    if (entry.type === 'incident.alert') {
      emit({ kind: 'entry', entry });
      return;
    }
    // Duplicates at or below the cursor are ignored (screen 8-2 recovery rule).
    const cursor = readCursor();
    if (cursor !== undefined && entry.seq <= cursor) return;
    writeCursor(entry.seq);
    emit({ kind: 'entry', entry });
  });
};

// A new access token during a session (auth api-design 02): the server re-validates it.
export const refreshLiveAuth = (token: string): void => {
  if (!socket) return;
  if (socket.connected) socket.emit('auth.refresh', { token });
  // A closed socket reads the latest token and cursor in its `auth` callback when it reconnects.
  else if (!socket.active) socket.connect();
};

export const stopLive = (): void => {
  socket?.disconnect();
  socket = null;
  recovering = false;
  writeCursor(null);
  setPaused(false);
};
