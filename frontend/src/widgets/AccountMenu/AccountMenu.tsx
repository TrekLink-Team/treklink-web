import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEMO_ROLES,
  demoMessageOf,
  switchDemoRole,
  useDemoStatus,
  type DemoRole,
} from '../../entities/demo/api';
import { useSession, type SessionUser } from '../../entities/session/model';
import { useAdoptDemoSession } from '../../features/demo-role-switch/useDemoSession';
import { logout, useMe } from '../../features/account-menu/api';
import { PASSWORD_CHANGED_NOTICE } from '../../features/password/api';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { initialsOf, roleLabel } from './labels';
import { Menu, useToast, type MenuItem } from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';

const organizationLine = (organization: NonNullable<SessionUser['organization']>) =>
  `${organization.legalName} (${organization.code}), ${organization.status}`;

// Screen 2.2: the account menu in the header of every signed-in page, a `Menu` whose header holds the
// read-only profile (auth api-design 04). Change password opens the dialog (auth 08) and Sign out ends
// the session (auth 03). Nothing shows while signed out.
export const AccountMenu: React.FC = () => {
  const navigate = useNavigate();
  const tokens = useSession((state) => state.tokens);
  const endSession = useSession((state) => state.signOut);
  const showToast = useToast((state) => state.show);
  const { data: me } = useMe();
  const [changing, setChanging] = useState(false);
  // Demo mode (D-088, screen 7.5): every signed-in user can switch to a seeded role from the menu, so
  // a window signed in as the Manager can switch back to the Admin.
  const demoOn = useDemoStatus(tokens !== null).data?.enabled === true;
  const adoptDemoSession = useAdoptDemoSession();
  const [switching, setSwitching] = useState(false);

  if (!tokens) return null;

  // The client ends its session even when the server call fails; the refresh token then expires on
  // its own (screen 2.2, "Sign-out fails").
  const signOut = async (notice?: string) => {
    try {
      await logout(tokens.refreshToken);
    } catch {
      // Ignored: the session ends locally either way.
    }
    endSession(true);
    navigate('/sign-in', { replace: true, state: notice ? { notice } : undefined });
  };

  // The menu closes on choosing an item, so a refusal shows as an error toast.
  const switchRole = async (role: DemoRole) => {
    setSwitching(true);
    try {
      adoptDemoSession(await switchDemoRole(role));
    } catch (failure) {
      showToast(demoMessageOf(failure, messageOf), { tone: 'error' });
    } finally {
      setSwitching(false);
    }
  };

  const items: MenuItem[] = me
    ? [
        { key: 'password', label: 'Change password', onSelect: () => setChanging(true) },
        ...(demoOn
          ? DEMO_ROLES.map(({ role, label }): MenuItem => {
              const current = me.roles.includes(role);
              return {
                key: `role-${role}`,
                label: `Switch to ${label}`,
                onSelect: () => void switchRole(role),
                disabled: current || switching,
                disabledReason: current ? 'You are signed in as this role.' : 'Switching role.',
              };
            })
          : []),
        { key: 'sign-out', label: 'Sign out', onSelect: () => void signOut() },
      ]
    : [];

  return (
    <>
      <Menu
        // The name starts with the visible text at every width: the initials alone below 1024 px, the
        // initials and the full name above (WCAG 2.5.3, re-check of treklink-web#350).
        label={me ? `${initialsOf(me.fullName)} ${me.fullName}, account menu` : 'Account menu'}
        items={items}
        align="end"
        triggerClassName="h-11 min-w-11 gap-2 px-1 sm:pr-3"
        header={
          me && (
            <>
              <p className="font-semibold">{me.fullName}</p>
              <p className="text-body-sm text-ink-muted">{me.email}</p>
              <p className="text-body-sm text-ink-muted">{roleLabel(me.roles)}</p>
              {me.organization && (
                <p className="text-body-sm text-ink-muted">{organizationLine(me.organization)}</p>
              )}
            </>
          )
        }
        trigger={
          <>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-chrome text-caption font-extrabold text-brand"
            >
              {me ? initialsOf(me.fullName) : '…'}
            </span>
            {/* A real space, so the visible text reads "DD Khoa Do Dang" as the name does (2.5.3). */}
            {me && ' '}
            {me && (
              <span className="sr-only lg:not-sr-only lg:max-w-[10rem] lg:truncate">
                {me.fullName}
              </span>
            )}
          </>
        }
      />

      {changing && (
        <ChangePasswordDialog
          onClose={() => setChanging(false)}
          // The server ended every session, this one included (D-063 rule 1).
          onChanged={() => void signOut(PASSWORD_CHANGED_NOTICE)}
        />
      )}
    </>
  );
};
