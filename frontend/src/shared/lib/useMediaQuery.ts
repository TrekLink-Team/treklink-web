import { useEffect, useState } from 'react';

const read = (query: string, fallback: boolean): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : fallback;

// Whether a CSS media query matches now and after the window changes. Without `matchMedia` (a test
// renderer) it answers `fallback`.
export const useMediaQuery = (query: string, fallback = false): boolean => {
  const [matches, setMatches] = useState(() => read(query, fallback));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
};
