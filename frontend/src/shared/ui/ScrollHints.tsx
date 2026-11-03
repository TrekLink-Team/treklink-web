import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ScrollHintState } from './useScrollHints';

// Hints of a strip that scrolls sideways (chapter 06 §10.6, D-096): on each side with more content, a
// fading edge from the surface colour and an arrow button that scrolls about 70 % of the visible
// width. The arrows are pointer aids: out of the tab order and hidden from screen readers, because
// keyboard users reach every item with Tab or the arrow keys. The strip's wrapper must be
// `position: relative` (rule 4), so visually hidden text inside stays inside it.

const ARROW =
  'absolute top-1/2 z-[3] flex h-11 w-8 -translate-y-1/2 items-center justify-center rounded-control text-ink hover:bg-chrome/60';

/** The fading edges and arrows over a strip; place it inside the strip's relative wrapper. */
export const ScrollHintOverlay: React.FC<{ hints: ScrollHintState; surface?: 'surface' | 'ground' }> = ({
  hints,
  surface = 'surface',
}) => {
  const from = surface === 'surface' ? 'from-surface' : 'from-ground';
  return (
    <>
      {hints.left && (
        <>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 left-0 z-[2] w-14 bg-gradient-to-r ${from} from-45% to-transparent`}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-scroll-hint="left"
            onClick={() => hints.scroll(-1)}
            className={`${ARROW} left-0`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </>
      )}
      {hints.right && (
        <>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 right-0 z-[2] w-14 bg-gradient-to-l ${from} from-45% to-transparent`}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-scroll-hint="right"
            onClick={() => hints.scroll(1)}
            className={`${ARROW} right-0`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </>
  );
};
