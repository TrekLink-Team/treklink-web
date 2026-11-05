import { io, Socket } from 'socket.io-client';

// How long a loopback client waits for the handshake of the `/live` namespace. The first two socket
// suites waited 3 s and the CI runner missed it once (review of #372), so the one helper that the
// socket db-specs share waits longer than that; a suite that fails here still fails well inside the
// 20 s of a case.
export const LIVE_HANDSHAKE_TIMEOUT_MS = 10_000;

// A client of the `/live` namespace with the credentials in `auth` (a token, or an API key). `attach`
// runs before the connection starts, so a suite can listen for the entries that arrive with the
// handshake as well. Resolves when the socket is connected; rejects with the `connect_error` of a
// refused handshake, or with `Handshake timed out`, and closes the socket in both cases.
export const openLiveSocket = async (
  url: string,
  auth: Record<string, unknown>,
  attach: (socket: Socket) => void = () => undefined,
  timeoutMs: number = LIVE_HANDSHAKE_TIMEOUT_MS,
): Promise<Socket> => {
  const socket = io(url, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
  });
  attach(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Handshake timed out'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.connect();
  });
  return socket;
};
