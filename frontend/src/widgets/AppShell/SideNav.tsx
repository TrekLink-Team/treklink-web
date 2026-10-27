import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { NavGroup } from '../../shared/config/navigation';
import { cn } from '../../shared/ui/cn';

interface SideNavProps {
  groups: NavGroup[];
  /** Icon rail: labels become tooltips and accessible names. */
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
  className?: string;
}

/** Module navigation of the left panel, grouped by area, drawn from shared/config/navigation.ts. */
export const SideNav: React.FC<SideNavProps> = ({ groups, collapsed = false, onNavigate, onToggleCollapse, className }) => (
  <nav aria-label="Modules" className={cn('flex min-h-0 flex-col', className)}>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden pb-2">
      {groups.map((group) => (
        <div key={group.id} role="group" aria-labelledby={`nav-${group.id}`} className="flex flex-col gap-0.5">
          <span
            id={`nav-${group.id}`}
            className={cn('px-3 pb-1 pt-1 text-label uppercase text-ink-muted', collapsed && 'sr-only')}
          >
            {group.label}
          </span>
          {collapsed && <span aria-hidden="true" className="mx-3 mb-1 h-px bg-line first:hidden" />}
          {group.entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <NavLink
                key={entry.route}
                to={entry.route}
                end={entry.route.split('/').length <= 2}
                onClick={onNavigate}
                title={collapsed ? entry.label : undefined}
                aria-label={collapsed ? entry.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'group flex min-h-10 items-center gap-3 rounded-control px-3 text-body font-medium transition duration-tl ease-tl focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-spark font-extrabold text-on-spark' : 'text-ink hover:bg-chrome/70',
                  )
                }
              >
                <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="truncate">{entry.label}</span>}
              </NavLink>
            );
          })}
        </div>
      ))}
    </div>
    {onToggleCollapse && (
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className={cn(
          'mt-2 flex min-h-10 items-center gap-3 rounded-control border border-line px-3 text-body-sm font-semibold text-ink-muted transition hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus',
          collapsed && 'justify-center px-0',
        )}
      >
        {collapsed ? <ChevronsRight aria-hidden="true" className="h-4 w-4" /> : <ChevronsLeft aria-hidden="true" className="h-4 w-4" />}
        {!collapsed && 'Collapse'}
      </button>
    )}
  </nav>
);
