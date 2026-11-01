import { useEffect, useState } from 'react';
import { useSession } from '../../entities/session/model';
import { isLivePaused, livePolls, subscribeLive } from '../../shared/socket/socketClient';

export type ConnectionState = 'connected' | 'polling' | 'reconnecting' | 'offline';

// The live connection as the header shows it: offline when the browser has no network or nobody is
// signed in (no socket), polling in poll mode (no socket, views refetched on a timer), reconnecting
// while the socket is paused (MSG32), otherwise connected.
export const useConnection = (): ConnectionState => {
  const signedIn = useSession((state) => state.user !== null);
  const [paused, setPaused] = useState(isLivePaused());
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(
    () =>
      subscribeLive((message) => {
        if (message.kind === 'paused') setPaused(message.paused);
      }),
    [],
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (!online || !signedIn) return 'offline';
  if (livePolls()) return 'polling';
  return paused ? 'reconnecting' : 'connected';
};
