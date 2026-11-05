import React from 'react';
import { BrandMark } from './BrandMark';
import { EnvironmentBadge } from './EnvironmentBadge';
import { ThemeToggle } from './ThemeToggle';

/**
 * The signed-out frame for sign-in, forgot, reset and welcome: the mark, the environment and a
 * theme switch over the backdrop, with the page's own card in the middle. No navigation, no live
 * state. `wide` is for public pages that are not a single form. A skip link to the content comes
 * first, as in the app shell (screen 2.3, W20B item 9).
 */
export const AuthLayout: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({ children, wide }) => (
  <div className="tl-backdrop flex min-h-dvh flex-col text-ink">
    <a
      href="#main"
      className="sr-only z-banner rounded-control bg-surface px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
    >
      Skip to content
    </a>
    <header className="flex h-header items-center gap-2 px-4">
      <BrandMark />
      <EnvironmentBadge className="ml-2" />
      <ThemeToggle className="ml-auto" />
    </header>
    <main id="main" tabIndex={-1} className="flex flex-1 outline-none items-start justify-center px-4 pb-10 pt-4 sm:items-center sm:pt-0">
      <div className={wide ? 'w-full max-w-page' : 'w-full max-w-md'}>{children}</div>
    </main>
    <footer className="px-4 pb-4 text-center text-caption text-ink-muted">LoRa mesh trekking safety, TrekLink</footer>
  </div>
);
