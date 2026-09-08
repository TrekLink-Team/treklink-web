import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';

let socket: Socket | null = null;

export function getSocketClient(): Socket {
  if (!socket) {
    const token = localStorage.getItem('treklink_access_token');
    socket = io(WS_URL, {
      auth: { token },
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}
