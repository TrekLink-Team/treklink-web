import { useEffect, useState } from 'react';

// The value once it has been still for `ms`, so typing sends one request instead of one per key.
export const useDebounced = <T>(value: T, ms: number): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
};
