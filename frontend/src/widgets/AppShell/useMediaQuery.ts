import { useCallback, useSyncExternalStore } from 'react';

/** True while the media query matches. False where matchMedia is missing (tests, old browsers). */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  const snapshot = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
  return useSyncExternalStore(subscribe, snapshot, () => false);
};
