import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from './cn';

/**
 * Sticky page chrome for long and multi-step pages (leader rule of 2026-10-30, design-system §5.2):
 * the title, breadcrumb and stepper stay at the top of the content area and turn compact once the
 * content scrolls; the action bar (Back, Next, the primary action) stays at the bottom; only the
 * content between them scrolls.
 */

/** How far the content scrolls, in px, before the header turns compact. */
export const COMPACT_AFTER_PX = 24;

/** Hides an element of the header while it is compact (a description, a context line). */
export const COMPACT_HIDDEN = 'group-data-[compact=true]/chrome:hidden';

/**
 * What the app shell lends a sticky header: its breadcrumb, which then renders inside the header
 * instead of above it, so the trail stays in view with the title.
 */
export interface PageChromeSlot {
  breadcrumb: React.ReactNode;
  /** Called by a mounted header; the shell hides its own breadcrumb until the returned cleanup. */
  claim: () => () => void;
}

const PageChromeContext = createContext<PageChromeSlot | null>(null);

export const PageChromeProvider = PageChromeContext.Provider;

/** The nearest scrolling ancestor; null means the document scrolls. */
const scrollParentOf = (node: HTMLElement): HTMLElement | null => {
  for (let element = node.parentElement; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  return null;
};

/**
 * Publishes the element's height as a CSS variable on its scroll container. The shell turns the two
 * variables into scroll-padding, so keyboard focus never lands under the header or the action bar,
 * and sticky side panels offset their `top` by the header height.
 */
const usePublishedHeight = (
  ref: React.RefObject<HTMLElement>,
  name: string,
  onResize?: (height: number) => void,
) => {
  const resized = useRef(onResize);
  useLayoutEffect(() => {
    resized.current = onResize;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const host = scrollParentOf(node) ?? document.documentElement;
    const observer = new ResizeObserver(() => {
      host.style.setProperty(name, `${node.offsetHeight}px`);
      resized.current?.(node.offsetHeight);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      host.style.removeProperty(name);
    };
  }, [ref, name]);
};

/**
 * Keeps keyboard focus clear of a sticky edge. The scroll-padding the shell sets covers anchors and
 * most browsers, but Chrome does not scroll on focus when the control is inside the scroll box and
 * only covered by the sticky element; this moves it out, with `scrollIntoView`, which honours the
 * scroll-padding. It runs on focus only, never on scroll.
 */
const useFocusClearOf = (ref: React.RefObject<HTMLElement>, edge: 'top' | 'bottom') => {
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const host = scrollParentOf(node) ?? document;
    const onFocus = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || node.contains(target)) return;
      const cover = node.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const covered = edge === 'bottom' ? box.bottom > cover.top : box.top < cover.bottom;
      if (covered && typeof target.scrollIntoView === 'function')
        target.scrollIntoView({ block: 'nearest' });
    };
    host.addEventListener('focusin', onFocus);
    return () => host.removeEventListener('focusin', onFocus);
  }, [ref, edge]);
};

/**
 * The page header region: pass the PageHeader or PageTitle, a back link and the stepper or view tabs
 * as children. It sticks to the top of the content area. A one-pixel sentinel at the top of the
 * scrolling content is watched with an IntersectionObserver (no scroll handler): once it has
 * scrolled COMPACT_AFTER_PX out of view the region sets `data-compact`, and the shared PageHeader,
 * PageTitle and Stepper shrink. The sentinel is absolutely placed, so the region adds one item to a
 * flex or grid parent and works inside a `gap` layout.
 *
 * While compact, a bottom margin on the region takes up the height the header gave back, so the
 * content does not jump and the page height does not change (which would otherwise flip a page just
 * taller than the screen back and forth). Scroll anchoring is off in the scroll container while the
 * header is mounted: measuring the shrunk header forces a layout before the margin is set, and the
 * browser's anchoring correction in that layout scrolled back to the top and flipped the header
 * straight back to full height (seen in Chromium, 2026-10-30).
 */
export const StickyPageHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => {
  const slot = useContext(PageChromeContext);
  const sentinel = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const expanded = useRef(0);
  const [compact, setCompact] = useState(false);
  const compactNow = useRef(compact);

  // Before paint, so the shell's own breadcrumb never shows twice.
  useLayoutEffect(() => slot?.claim(), [slot]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const host = scrollParentOf(node);
    const anchoring = host?.style.overflowAnchor ?? '';
    if (host) host.style.overflowAnchor = 'none';
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setCompact(!entry.isIntersecting);
      },
      { root: host, rootMargin: `${COMPACT_AFTER_PX}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (host) host.style.overflowAnchor = anchoring;
    };
  }, []);

  useLayoutEffect(() => {
    const node = box.current;
    compactNow.current = compact;
    if (!node) return;
    if (compact) {
      node.style.marginBottom = `${Math.max(0, expanded.current - node.offsetHeight)}px`;
    } else {
      expanded.current = node.offsetHeight;
      node.style.marginBottom = '';
    }
  }, [compact]);

  usePublishedHeight(box, '--tl-page-header-h', (height) => {
    if (!compactNow.current) expanded.current = height;
  });
  useFocusClearOf(box, 'top');

  return (
    <>
      <div
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px"
      />
      <div
        ref={box}
        data-compact={compact ? 'true' : 'false'}
        className={cn(
          'group/chrome sticky top-0 z-raised -mx-1 flex flex-col rounded-panel border px-1 md:-mx-2 md:px-2',
          compact
            ? 'tl-glass-strong py-2 shadow-glass [&>*:last-child]:mb-0'
            : 'border-transparent',
          className,
        )}
      >
        {slot?.breadcrumb}
        {children}
      </div>
    </>
  );
};

/**
 * The page action bar: Back on the left (`start`), Next or the primary action on the right
 * (children, primary last). It sticks to the bottom of the content area, above the phone tab bar,
 * with the safe-area inset added on phones. Put it last in the page section and give the section
 * `flex flex-1 flex-col`, so the bar also sits at the bottom when the content is short.
 *
 * A submit button for a form elsewhere on the page takes the form's id: `<Button type="submit"
 * form="sign-form">`.
 */
export const PageActionBar: React.FC<{
  /** Names the group for screen readers, for example "Handover steps". */
  label: string;
  start?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}> = ({ label, start, children, className }) => {
  const box = useRef<HTMLDivElement>(null);
  usePublishedHeight(box, '--tl-page-actions-h');
  useFocusClearOf(box, 'bottom');
  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      data-page-actions=""
      className={cn(
        'tl-glass-strong sticky bottom-0 z-raised -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-panel px-2 pt-2 shadow-glass md:-mx-2 md:px-3',
        'pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
        className,
        // Last, so a caller's margin never removes it: the bar sits at the bottom of short content.
        'mt-auto',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">{start}</div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
};
