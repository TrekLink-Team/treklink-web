import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { SessionUser } from '../../entities/session/model';
import { isFullBleed, visibleNav } from '../../shared/config/navigation';
import { cn } from '../../shared/ui/cn';
import { Drawer } from '../../shared/ui/Drawer';
import { Switch } from '../../shared/ui/Field';
import { useTheme } from '../../shared/lib/theme';
import { AppHeader } from './AppHeader';
import { BrandMark } from './BrandMark';
import { InfoPane } from './InfoPane';
import { MobileTabBar } from './MobileTabBar';
import { QuickNav } from './QuickNav';
import { ShellBreadcrumb } from './ShellBreadcrumb';
import { useShell } from './shellStore';
import { SideNav } from './SideNav';
import { DOCKED_QUERY } from './useInfoPane';
import { useMediaQuery } from './useMediaQuery';
import { workspaceOf } from './workspace';

interface AppShellProps {
  user: SessionUser;
  /** Where the mark links to: the user's landing route. */
  home: string;
  /** The incident banner; rendered first, above the header, never covered (convention 06 §8.9). */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The signed-in frame (DS-13): banner, header, the left module navigation, the body with its
 * breadcrumb, and the right Info pane. Map routes are full-bleed and have no Info pane.
 *
 * Breakpoints: phone below 768 px (drawer plus bottom tab bar), tablet 768 to 1023 px (icon rail
 * plus drawer), desktop from 1024 px (sidebar, collapsible to the rail). The Info pane docks from
 * 1280 px and opens as a sheet below that.
 */
export const AppShell: React.FC<AppShellProps> = ({ user, home, banner, children }) => {
  const { pathname } = useLocation();
  const groups = useMemo(() => visibleNav(user.accountType, user.roles), [user.accountType, user.roles]);
  const fullBleed = isFullBleed(pathname);
  const workspace = workspaceOf(user);

  const collapsed = useShell((state) => state.navCollapsed);
  const toggleNav = useShell((state) => state.toggleNav);
  const drawerOpen = useShell((state) => state.drawerOpen);
  const setDrawer = useShell((state) => state.setDrawer);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const wide = useMediaQuery(DOCKED_QUERY);
  const theme = useTheme((state) => state.resolved);
  const toggleTheme = useTheme((state) => state.toggle);

  // Overlays start under the incident banner so it is never covered (convention 06 §8.9): its
  // height is published as --tl-banner-h for Dialog, Drawer and the Go to dialog.
  const bannerBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = bannerBox.current;
    const root = document.documentElement;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => root.style.setProperty('--tl-banner-h', `${node.offsetHeight}px`));
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--tl-banner-h');
    };
  }, []);

  // A route change closes the drawer; growing past the breakpoint does too.
  useEffect(() => setDrawer(false), [pathname, setDrawer]);
  useEffect(() => {
    if (desktop) setDrawer(false);
  }, [desktop, setDrawer]);

  return (
    <div className="tl-backdrop relative flex h-dvh flex-col overflow-hidden text-ink">
      <a
        href="#main"
        className="sr-only z-banner rounded-control bg-surface px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <div ref={bannerBox} className="relative z-banner shrink-0">
        {banner}
      </div>
      <AppHeader user={user} home={home} />
      <QuickNav groups={groups} />

      <div className="flex min-h-0 flex-1 gap-2.5 p-2.5 pb-[calc(theme(spacing.tabbar)+0.625rem)] md:pb-2.5">
        <div
          className={cn(
            'tl-glass hidden shrink-0 flex-col rounded-panel p-2 md:flex',
            collapsed || !desktop ? 'w-rail' : 'w-nav',
            'transition-[width] duration-tl ease-tl',
          )}
        >
          <SideNav
            groups={groups}
            collapsed={collapsed || !desktop}
            onToggleCollapse={desktop ? toggleNav : undefined}
            className="h-full"
          />
        </div>

        <main
          id="main"
          tabIndex={-1}
          className={cn('relative flex min-w-0 flex-1 flex-col outline-none', fullBleed ? 'overflow-y-auto' : 'overflow-y-auto px-1 md:px-2')}
        >
          <div className={cn('mx-auto flex w-full flex-1 flex-col', !fullBleed && 'max-w-page pb-6 pt-1')}>
            <ShellBreadcrumb groups={groups} workspace={workspace.name} />
            {children}
          </div>
        </main>

        {!fullBleed && <InfoPane docked={wide} />}
      </div>

      <MobileTabBar groups={groups} onMore={() => setDrawer(true)} />

      {drawerOpen && (
        <Drawer titleId="nav-drawer-title" title="Navigation" hideTitle side="left" onClose={() => setDrawer(false)}>
          <div className="mb-4 flex flex-col gap-1 border-b border-line pb-4">
            <BrandMark />
            <p className="mt-2 text-body-sm">
              <span className="font-bold text-ink">{workspace.name}</span>
              {workspace.code && <span className="ml-2 font-mono text-caption text-ink-muted">{workspace.code}</span>}
            </p>
          </div>
          <SideNav groups={groups} onNavigate={() => setDrawer(false)} />
          <div className="mt-4 border-t border-line pt-2">
            <Switch label="Dark theme" checked={theme === 'dark'} onChange={toggleTheme} />
          </div>
        </Drawer>
      )}
    </div>
  );
};
