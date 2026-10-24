import { io, type Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';
const CURSOR_KEY = 'treklink.live.cursor';

// One entry of the stream (monitoring ws-live-contract). A push and a REST replay carry this shape.
export interface LiveEntry {
  seq: number;
  type: string;
  deviceId?: string;
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
  if (socket) return;

  socket = io(`${WS_URL}/live`, {
    auth: (send) => send({ token: getAccessToken(), after: readCursor() }),
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    // Without a cursor the server sends no replay, so there is nothing to wait for.
    if (readCursor() === undefined) setPaused(false);
  });
  socket.on('disconnect', () => setPaused(true));
  socket.on('stream', (entry: LiveEntry) => {
    if (entry.type === 'replay.done') {
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
    // Duplicates at or below the cursor are ignored (screen 8-2 recovery rule).
    const cursor = readCursor();
    if (cursor !== undefined && entry.seq <= cursor) return;
    writeCursor(entry.seq);
    emit({ kind: 'entry', entry });
  });
};

// A new access token during a session (auth api-design 02): the server re-validates it.
export const refreshLiveAuth = (token: string): void => {
  socket?.emit('auth.refresh', { token });
};

export const stopLive = (): void => {
  socket?.disconnect();
  socket = null;
  writeCursor(null);
  setPaused(false);
};
