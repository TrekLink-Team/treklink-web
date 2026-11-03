import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One polite live region per collection (chapter 06 §9.7, WCAG 4.1.3). The region is rendered from
 * the first paint, empty, so a screen reader is already listening when the first message arrives.
 * `announce(text, { debounce })` waits for input to pause, for the search announcements. The same
 * text twice in a row is still announced: a no-break space is toggled at its end.
 */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

export const useLiveRegion = () => {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const flip = useRef(false);

  const announce = useCallback((text: string, options: { debounce?: number } = {}) => {
    window.clearTimeout(timer.current);
    const say = () => {
      flip.current = !flip.current;
      setMessage(flip.current ? text : `${text}${NO_BREAK_SPACE}`);
    };
    if (options.debounce) timer.current = window.setTimeout(say, options.debounce);
    else say();
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { message, announce };
};
