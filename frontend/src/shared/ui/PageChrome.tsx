import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from './cn';
import { scrollParentOf, useEdgeNode, useFocusClearOf, usePublishedHeight } from './stickyEdges';

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
  const box = useRef<HTMLDivElement | null>(null);
  const [boxNode, setBoxNode] = useState<HTMLDivElement | null>(null);
  const setBox = useCallback((node: HTMLDivElement | null) => {
    box.current = node;
    setBoxNode(node);
  }, []);
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
        if (!entry) return;
        const compacting = !entry.isIntersecting;
        // Reserve the full expanded height before the header shrinks (treklink-web#348). Measuring
        // the shrunk header forces a layout; without this reserve that layout made the page shorter,
        // the browser clamped scrollTop back under the threshold, the header expanded again, and a
        // page only a little taller than the screen could never scroll to its last rows. The layout
        // effect below replaces the reserve with the exact difference before paint.
        if (compacting && !compactNow.current && box.current) {
          box.current.style.marginBottom = `${expanded.current || box.current.offsetHeight}px`;
        }
        setCompact(compacting);
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

  usePublishedHeight(boxNode, '--tl-page-header-h', (height) => {
    if (!compactNow.current) expanded.current = height;
  });
  useFocusClearOf(boxNode, 'top');

  return (
    <>
      <div
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px"
      />
      <div
        ref={setBox}
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
  /** The actions take the bar's whole width, so a `flex-1` primary action is the widest (§10.5). */
  stretch?: boolean;
}> = ({ label, start, children, className, stretch }) => {
  const [barNode, setBarNode] = useEdgeNode<HTMLDivElement>();
  usePublishedHeight(barNode, '--tl-page-actions-h');
  useFocusClearOf(barNode, 'bottom');
  return (
    <div
      ref={setBarNode}
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
      <div className={cn('ml-auto flex flex-wrap items-center justify-end gap-2', stretch && 'flex-1')}>
        {children}
      </div>
    </div>
  );
};
