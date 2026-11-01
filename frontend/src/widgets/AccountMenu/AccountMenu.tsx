import React, { useEffect, useRef, useState } from 'react';
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
import { messageOf } from '../../shared/ui/errors';

const organizationLine = (organization: NonNullable<SessionUser['organization']>) =>
  `${organization.legalName} (${organization.code}), ${organization.status}`;

// Screen 2.2: the account menu in the header of every signed-in page. The profile is read-only
// (auth api-design 04); Change password opens the dialog (auth 08) and Sign out ends the session
// (auth 03). Nothing shows while signed out.
export const AccountMenu: React.FC = () => {
  const navigate = useNavigate();
  const tokens = useSession((state) => state.tokens);
  const endSession = useSession((state) => state.signOut);
  const { data: me } = useMe();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  // Demo mode (D-088, screen 7.5): every signed-in user can switch to a seeded role from the menu, so
  // a window signed in as the Manager can switch back to the Admin.
  const demoOn = useDemoStatus(tokens !== null).data?.enabled === true;
  const adoptDemoSession = useAdoptDemoSession();
  const [switching, setSwitching] = useState<DemoRole | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  // A pointer pressed anywhere outside the menu and its button closes the menu, and focus stays
  // where the user put it (WAI-ARIA menu button pattern, review of #67).
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  if (!tokens) return null;

  // Tab out of the last item, or Shift+Tab out of the first, closes the menu; moving focus between
  // its items or back to the button does not.
  const closeOnFocusOut = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (menu.current?.contains(next) || button.current?.contains(next)) return;
    setOpen(false);
  };

  const closeMenu = () => {
    setOpen(false);
    button.current?.focus();
  };

  // The client ends its session even when the server call fails; the refresh token then expires on
  // its own (screen 2.2, "Sign-out fails").
  const signOut = async (notice?: string) => {
    setOpen(false);
    try {
      await logout(tokens.refreshToken);
    } catch {
      // Ignored: the session ends locally either way.
    }
    endSession(true);
    navigate('/sign-in', { replace: true, state: notice ? { notice } : undefined });
  };

  const switchRole = async (role: DemoRole) => {
    setSwitching(role);
    setSwitchError(null);
    try {
      const session = await switchDemoRole(role);
      setOpen(false);
      adoptDemoSession(session);
    } catch (failure) {
      setSwitchError(demoMessageOf(failure, messageOf));
    } finally {
      setSwitching(null);
    }
  };

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length].focus();
    }
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 min-w-11 items-center gap-2 rounded-control px-1 text-body-sm font-semibold text-ink transition duration-tl hover:bg-chrome/60 sm:pr-3"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-chrome text-caption font-extrabold text-brand"
        >
          {me ? initialsOf(me.fullName) : '…'}
        </span>
        {/* The name comes from the content so the visible text is part of it (WCAG 2.5.3). */}
        <span className="sr-only">{me ? 'Account: ' : 'Account'}</span>
        {me && <span className="sr-only lg:not-sr-only lg:max-w-[10rem] lg:truncate">{me.fullName}</span>}
      </button>

      {open && me && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          onKeyDown={moveFocus}
          onBlur={closeOnFocusOut}
          className="absolute right-0 top-12 z-drawer w-[min(20rem,calc(100vw-1rem))] rounded-panel border border-line bg-surface p-4 text-ink shadow-overlay"
        >
          <div className="border-b border-line pb-3">
            <p className="font-semibold">{me.fullName}</p>
            <p className="text-body-sm text-ink-muted">{me.email}</p>
            <p className="text-body-sm text-ink-muted">{roleLabel(me.roles)}</p>
            {me.organization && (
              <p className="text-body-sm text-ink-muted">{organizationLine(me.organization)}</p>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
            className="mt-2 flex h-11 w-full items-center rounded-control px-3 text-left text-body font-semibold hover:bg-chrome/60"
          >
            Change password
          </button>
          {demoOn && (
            <div role="group" aria-label="Switch role" className="mt-2 border-t border-line pt-2">
              <p className="px-3 text-caption font-semibold text-ink-muted">Switch role (demo)</p>
              {DEMO_ROLES.map(({ role, label }) => (
                <button
                  key={role}
                  type="button"
                  role="menuitem"
                  disabled={switching !== null}
                  aria-current={me.roles.includes(role) || undefined}
                  onClick={() => void switchRole(role)}
                  className="flex h-11 w-full items-center rounded-control px-3 text-left text-body font-semibold hover:bg-chrome/60 disabled:opacity-60"
                >
                  {switching === role ? `Switching to ${label}...` : label}
                </button>
              ))}
              {switchError && (
                <p role="alert" className="px-3 text-body-sm text-status-critical-fg">
                  {switchError}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="flex h-11 w-full items-center rounded-control px-3 text-left text-body font-semibold hover:bg-chrome/60"
          >
            Sign out
          </button>
        </div>
      )}

      {changing && (
        <ChangePasswordDialog
          onClose={() => {
            setChanging(false);
            button.current?.focus();
          }}
          // The server ended every session, this one included (D-063 rule 1).
          onChanged={() => void signOut(PASSWORD_CHANGED_NOTICE)}
        />
      )}
    </div>
  );
};
