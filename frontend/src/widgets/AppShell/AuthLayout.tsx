import React from 'react';
import { PageChromeProvider, type PageChromeSlot } from '../../shared/ui/PageChrome';
import { BrandMark } from './BrandMark';
import { EnvironmentBadge } from './EnvironmentBadge';
import { ThemeToggle } from './ThemeToggle';

/**
 * The signed-out frame for sign-in, forgot, reset and welcome: the mark, the environment and a
 * theme switch over the backdrop, with the page's own card in the middle. No navigation, no live
 * state. `wide` is for public pages that are not a single form. A skip link to the content comes
 * first, as in the app shell (screen 2.3, W20B item 9).
 */
// No breadcrumb on public pages; the slot only lets a PageHeader pin itself in main (ui standard §7).
const PUBLIC_CHROME: PageChromeSlot = { breadcrumb: null, claim: () => () => undefined };

export const AuthLayout: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({ children, wide }) => (
  // Fixed to the viewport like the app shell: the document never scrolls, the header stays and
  // main is the one scroll region; at 400 % zoom the frame releases and the document scrolls
  // (ui standard §7).
  <div className="tl-backdrop flex h-dvh flex-col overflow-hidden text-ink [@media(max-height:479.98px)]:h-auto [@media(max-height:479.98px)]:min-h-dvh [@media(max-height:479.98px)]:overflow-visible">
    <a
      href="#main"
      className="sr-only z-banner rounded-control bg-surface px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
    >
      Skip to content
    </a>
    <header className="flex h-header shrink-0 items-center gap-2 px-4">
      <BrandMark />
      <EnvironmentBadge className="ml-2" />
      <ThemeToggle className="ml-auto" />
    </header>
    <main
      id="main"
      tabIndex={-1}
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 outline-none [@media(max-height:479.98px)]:overflow-visible"
    >
      {/* Auto margins centre the card from 640 px and collapse when it is taller than main, so its
          top is never cut off. */}
      <div className={`mx-auto w-full pb-10 pt-4 sm:my-auto sm:pt-0 ${wide ? 'max-w-page' : 'max-w-md'}`}>
        <PageChromeProvider value={PUBLIC_CHROME}>{children}</PageChromeProvider>
      </div>
      <footer className="pb-4 text-center text-caption text-ink-muted">LoRa mesh trekking safety, TrekLink</footer>
    </main>
  </div>
);
