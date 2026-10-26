import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../app/providers/useAuth';
import { hasAnyRole, type Role } from '../../shared/lib/permissions';

interface Entry {
  to: string;
  label: string;
  roles: readonly Role[];
}

// Header entries for the built pages, shown only to the roles that hold the route
// (specs/frontend/design.md §2). The server refuses the data either way.
const ENTRIES: Entry[] = [
  { to: '/o/contracts', label: 'Contracts', roles: ['ORG_OPERATOR'] },
  { to: '/o/invoices', label: 'Invoices', roles: ['ORG_MANAGER'] },
  { to: '/t/contracts', label: 'Contract requests', roles: ['STAFF'] },
  { to: '/t/billing', label: 'Billing', roles: ['STAFF'] },
];

export const MainNav: React.FC = () => {
  const { user } = useAuth();
  if (!user) return null;
  const entries = ENTRIES.filter((entry) => hasAnyRole(user.roles, entry.roles));
  return (
    <>
      {entries.map((entry) => (
        <NavLink
          key={entry.to}
          to={entry.to}
          className={({ isActive }) =>
            `transition hover:text-white ${isActive ? 'text-white underline underline-offset-4' : ''}`
          }
        >
          {entry.label}
        </NavLink>
      ))}
    </>
  );
};
