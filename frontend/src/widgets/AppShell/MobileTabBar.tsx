import React from 'react';
import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { tabBarEntries, type NavGroup } from '../../shared/config/navigation';
import { cn } from '../../shared/ui/cn';

/** The phone's bottom bar: up to four key modules and More, which opens the full drawer. */
export const MobileTabBar: React.FC<{ groups: NavGroup[]; onMore: () => void }> = ({ groups, onMore }) => {
  const entries = tabBarEntries(groups);
  const item = 'flex min-h-tabbar flex-col items-center justify-center gap-0.5 text-caption font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus';
  const pill = 'flex h-8 w-14 items-center justify-center rounded-full transition duration-tl';
  return (
    <nav
      aria-label="Main"
      className="tl-glass-strong fixed inset-x-0 bottom-0 z-sidebar grid border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${entries.length + 1}, minmax(0, 1fr))` }}
    >
      {entries.map((entry) => {
        const Icon = entry.icon;
        return (
          <NavLink key={entry.route} to={entry.route} end={entry.route.split('/').length <= 2} className={({ isActive }) => cn(item, isActive ? 'text-ink' : 'text-ink-muted')}>
            {({ isActive }) => (
              <>
                <span className={cn(pill, isActive && 'bg-spark text-on-spark')}>
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <span className={cn('max-w-full truncate px-1', isActive && 'font-extrabold')}>{entry.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
      <button type="button" onClick={onMore} className={cn(item, 'text-ink-muted')}>
        <span className={pill}>
          <Menu aria-hidden="true" className="h-5 w-5" />
        </span>
        More
      </button>
    </nav>
  );
};
