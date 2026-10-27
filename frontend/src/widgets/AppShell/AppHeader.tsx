import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, PanelLeft, Search } from 'lucide-react';
import type { SessionUser } from '../../entities/session/model';
import { IconButton } from '../../shared/ui/Button';
import { AccountMenu } from '../AccountMenu/AccountMenu';
import { BrandMark } from './BrandMark';
import { ConnectionIndicator } from './ConnectionIndicator';
import { EnvironmentBadge } from './EnvironmentBadge';
import { useShell } from './shellStore';
import { workspaceOf } from './workspace';
import { ThemeToggle } from './ThemeToggle';

/**
 * The header row (DS-13): navigation toggle, mark, workspace, environment, Go to, live state, theme
 * and the account menu. 56 px high, liquid glass, always visible.
 */
export const AppHeader: React.FC<{ user: SessionUser; home: string }> = ({ user, home }) => {
  const collapsed = useShell((state) => state.navCollapsed);
  const toggleNav = useShell((state) => state.toggleNav);
  const setDrawer = useShell((state) => state.setDrawer);
  const setQuickNav = useShell((state) => state.setQuickNav);
  const workspace = workspaceOf(user);

  return (
    <header className="tl-glass relative z-header flex h-header shrink-0 items-center gap-1 rounded-none border-x-0 border-t-0 px-2 sm:gap-2 sm:px-3">
      <IconButton label="Open navigation" icon={<Menu />} size="lg" className="lg:hidden" onClick={() => setDrawer(true)} />
      <IconButton
        label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        icon={<PanelLeft />}
        className="hidden lg:inline-flex"
        onClick={toggleNav}
      />
      <Link to={home} className="flex min-h-11 items-center rounded-control px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" aria-label="TrekLink home">
        <BrandMark showWordmark={false} className="sm:hidden" />
        <BrandMark className="hidden sm:flex" />
      </Link>
      <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line md:block" />
      <p className="flex min-w-0 items-baseline gap-1.5 px-1 text-body-sm" title={workspace.name}>
        <span className="sr-only">Workspace: </span>
        <span className="hidden max-w-[14rem] truncate font-bold text-ink md:inline">{workspace.name}</span>
        {workspace.code && <span className="hidden font-mono text-caption font-semibold text-ink-muted sm:inline">{workspace.code}</span>}
      </p>
      <EnvironmentBadge className="ml-1" />

      <button
        type="button"
        onClick={() => setQuickNav(true)}
        aria-keyshortcuts="Control+K"
        className="mx-auto hidden h-10 w-full max-w-md items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-left text-body text-ink-muted transition hover:border-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:flex"
      >
        <Search aria-hidden="true" className="h-4 w-4" />
        <span className="flex-1">Go to page</span>
        <kbd className="rounded-badge border border-line px-1.5 font-mono text-caption">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1 lg:ml-0">
        <IconButton label="Go to page" icon={<Search />} className="lg:hidden" onClick={() => setQuickNav(true)} />
        <ConnectionIndicator />
        <ThemeToggle className="hidden sm:inline-flex" />
        <AccountMenu />
      </div>
    </header>
  );
};
