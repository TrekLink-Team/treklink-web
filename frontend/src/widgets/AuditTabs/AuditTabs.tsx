import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../shared/ui';

const LINKS = [
  { to: '/t/admin/audit/changes', label: 'Change log' },
  { to: '/t/admin/audit/sign-ins', label: 'Sign-ins' },
];

// The strip over the two audit screens (7.4 and 7.3). Each entry is a link to its own route, so a filter
// set in the URL of one never leaks into the other, and keyboard focus stays on the link that was
// followed instead of dropping to the page body when the strip is drawn again. The current page carries
// `aria-current="page"`.
export const AuditTabs: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col gap-4">
    <nav
      aria-label="Audit"
      className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]"
    >
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            cn(
              '-mb-px flex h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-body font-semibold transition duration-tl ease-tl focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
              isActive
                ? 'border-brand text-ink dark:border-accent'
                : 'border-transparent text-ink-muted hover:text-ink',
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
    {children}
  </div>
);
