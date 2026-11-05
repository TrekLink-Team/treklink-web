import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDemoStatus } from '../../entities/demo/api';
import { useDemoSimulation } from '../../entities/demo/simulation';
import type { SessionUser } from '../../entities/session/model';
import {
  ConnectorAside,
  ConnectorPanelBody,
  useConnectorStore,
  useDockPresence,
  useStartConnector,
} from '../../features/device-connector';
import { FlashFirmwarePanel } from '../../features/flash-firmware';
import type { FlashPanel } from '../../features/device-connector';
import { isFullBleed, visibleNav } from '../../shared/config/navigation';
import { cn } from '../../shared/ui/cn';
import { Drawer } from '../../shared/ui/Drawer';
import { Switch } from '../../shared/ui/Field';
import { PageChromeProvider, type PageChromeSlot } from '../../shared/ui/PageChrome';
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
// The hub's flash panel slot takes the panel's own props (devices design section 11.7, task 8.3).
const HubFlashPanel: FlashPanel = (props) => <FlashFirmwarePanel {...props} />;

export const AppShell: React.FC<AppShellProps> = ({ user, home, banner, children }) => {
  const { pathname } = useLocation();
  // The Demo control entry shows while the backend's demo controls are on (D-088) or, for an Admin, while
  // the field simulation answers (screen 7.5, D-094: the Vercel staging has the simulation alone).
  const simulation = useDemoSimulation(user.roles.includes('ADMIN'), false);
  const demoEnabled = useDemoStatus().data?.enabled === true || Boolean(simulation.data);
  const groups = useMemo(
    () => visibleNav(user.accountType, user.roles, { demoEnabled }),
    [user.accountType, user.roles, demoEnabled],
  );
  const fullBleed = isFullBleed(pathname);
  const workspace = workspaceOf(user);

  const collapsed = useShell((state) => state.navCollapsed);
  const toggleNav = useShell((state) => state.toggleNav);
  const drawerOpen = useShell((state) => state.drawerOpen);
  const setDrawer = useShell((state) => state.setDrawer);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const wide = useMediaQuery(DOCKED_QUERY);
  // The device connector, the Staff device hub (devices design section 12.2, screen 4.6): Staff and Admin
  // only (REQ-UBI-07). From 1100 px a non-modal aside pushed beside the page, from 600 px a drawer from
  // the right, below that a bottom sheet; only the drawers on full-bleed map routes. One right panel shows
  // at a time, so the Info pane yields while it is open (design section 12.12 Q6, decided A).
  const staff = user.accountType === 'TREKLINK';
  useStartConnector(staff);
  useDockPresence(staff);
  // The firmware flash panel (devices task 8.3) plugs into the hub's Update firmware (REQ-EVT-41).
  const registerFlashPanel = useConnectorStore((state) => state.registerFlashPanel);
  useEffect(() => {
    if (!staff) return undefined;
    registerFlashPanel(HubFlashPanel);
    return () => registerFlashPanel(null);
  }, [staff, registerFlashPanel]);
  const connectorOpen = useConnectorStore((state) => state.open) && staff;
  const setConnectorOpen = useConnectorStore((state) => state.setOpen);
  const connectorPushed = useMediaQuery('(min-width: 1100px)') && !fullBleed;
  const connectorSide = useMediaQuery('(min-width: 600px)') ? 'right' : 'bottom';
  const theme = useTheme((state) => state.resolved);
  const toggleTheme = useTheme((state) => state.toggle);

  // Overlays start under the incident banner so it is never covered (convention 06 §8.9): its
  // height is published as --tl-banner-h for Dialog, Drawer and the Go to dialog.
  const bannerBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = bannerBox.current;
    const root = document.documentElement;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() =>
      root.style.setProperty('--tl-banner-h', `${node.offsetHeight}px`),
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--tl-banner-h');
    };
  }, []);

  // A StickyPageHeader takes the breadcrumb into itself, so the trail stays in view with the title.
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  }, []);
  const chrome = useMemo<PageChromeSlot>(
    () => ({ breadcrumb: <ShellBreadcrumb groups={groups} workspace={workspace.name} />, claim }),
    [groups, workspace.name, claim],
  );

  // A route change closes the drawer; growing past the breakpoint does too.
  useEffect(() => setDrawer(false), [pathname, setDrawer]);
  useEffect(() => {
    if (desktop) setDrawer(false);
  }, [desktop, setDrawer]);

  return (
    <div
      className={cn(
        'tl-backdrop relative flex h-dvh flex-col overflow-hidden text-ink',
        // 400 % zoom (about 318 by 236 CSS px): the fixed bars release and the document scrolls, as
        // WCAG 1.4.10 allows; pinned bars would leave the content no room (ui standard §7).
        '[@media(max-height:479.98px)]:h-auto [@media(max-height:479.98px)]:min-h-dvh [@media(max-height:479.98px)]:overflow-visible',
      )}
    >
      <a
        href="#main"
        className="sr-only z-banner rounded-control bg-surface px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Skip to content
      </a>
      <div ref={bannerBox} className="relative z-banner shrink-0">
        {banner}
      </div>
      <AppHeader user={user} home={home} />
      <QuickNav groups={groups} />

      <div
        className={cn(
          'flex min-h-0 flex-1 gap-2.5 p-2.5 pb-[calc(theme(spacing.tabbar)+0.625rem)] md:pb-2.5',
          '[@media(max-height:479.98px)]:pb-2.5',
        )}
      >
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
          className={cn(
            'relative flex min-w-0 flex-1 flex-col outline-none',
            // The sticky page header, a CollectionView command bar under it and the page action bar
            // publish their heights; focus scrolls clear of all of them (chapter 06 §9.7, §10.1 rule 3).
            // The action bar stays in the flow at the end of its page, so its height is already part
            // of the scroll height and needs no padding-bottom (treklink-web#348).
            'scroll-pb-[calc(var(--tl-page-actions-h,0px)+0.5rem)] scroll-pt-[calc(var(--tl-page-header-h,0px)+var(--tl-collection-bar-h,0px)+0.5rem)]',
            // Not a scroll region of its own (ui standard §7): every page is a fit page and scrolls only
            // a nested region. The overflow stays as a fallback, so a page not yet built that way
            // still reaches its end; the route audit counts any page where #main scrolls as not done.
            fullBleed ? 'overflow-y-auto' : 'overflow-y-auto px-1 md:px-2',
            '[@media(max-height:479.98px)]:overflow-visible',
          )}
        >
          <div
            className={cn(
              'mx-auto flex w-full flex-1 flex-col',
              // A full-bleed page fills `main` and scrolls inside its own panes, so this wrapper must be
              // allowed to shrink to `main`; without `min-h-0` a tall list grows it and `main` scrolls
              // (the live map's Field Stations section, review of treklink-web#385).
              fullBleed && 'min-h-0',
              // A page action bar sits flush with the bottom, so its page drops the bottom padding.
              !fullBleed && 'max-w-page pb-6 pt-1 has-[[data-page-actions]]:pb-0',
              // A fit page (`data-fit-page`, ui standard §7) takes exactly the content area, so its
              // one scroll region fills what is left and #main does not scroll.
              'has-[[data-fit-page]]:min-h-0 has-[[data-fit-page]]:pb-2.5',
            )}
          >
            <PageChromeProvider value={chrome}>
              {claims === 0 && chrome.breadcrumb}
              {children}
            </PageChromeProvider>
          </div>
        </main>

        {connectorOpen && connectorPushed && <ConnectorAside onClose={() => setConnectorOpen(false)} />}
        {!fullBleed && !connectorOpen && <InfoPane docked={wide} />}
      </div>

      {connectorOpen && !connectorPushed && (
        <Drawer
          titleId="device-connector-drawer-title"
          title="Connected units"
          side={connectorSide}
          onClose={() => setConnectorOpen(false)}
        >
          <ConnectorPanelBody headingId="device-connector-drawer-title" />
        </Drawer>
      )}

      <MobileTabBar groups={groups} onMore={() => setDrawer(true)} />

      {drawerOpen && (
        <Drawer
          titleId="nav-drawer-title"
          title="Navigation"
          hideTitle
          side="left"
          onClose={() => setDrawer(false)}
        >
          <div className="mb-4 flex flex-col gap-1 border-b border-line pb-4">
            <BrandMark />
            <p className="mt-2 text-body-sm">
              <span className="font-bold text-ink">{workspace.name}</span>
              {workspace.code && (
                <span className="ml-2 font-mono text-caption text-ink-muted">{workspace.code}</span>
              )}
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
