import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, type SessionUser } from '../../entities/session/model';
import { logout, useMe } from '../../features/account-menu/api';
import { PASSWORD_CHANGED_NOTICE } from '../../features/password/api';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { initialsOf, roleLabel } from './labels';

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

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (!tokens) return null;

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
    endSession();
    navigate('/sign-in', { replace: true, state: notice ? { notice } : undefined });
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
        aria-label={me ? `Account: ${me.fullName}` : 'Account'}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 min-w-11 items-center gap-2 rounded-lg border border-slate-600 px-3 text-sm font-semibold text-white"
      >
        <span aria-hidden="true">{me ? initialsOf(me.fullName) : '…'}</span>
        <span className="hidden sm:inline">{me?.fullName}</span>
      </button>

      {open && me && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          onKeyDown={moveFocus}
          className="fixed inset-x-0 top-16 z-40 bg-white p-4 text-slate-900 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-80 sm:rounded-xl"
        >
          <div className="border-b border-slate-200 pb-3">
            <p className="font-semibold">{me.fullName}</p>
            <p className="text-sm text-slate-600">{me.email}</p>
            <p className="text-sm text-slate-600">{roleLabel(me.roles)}</p>
            {me.organization && (
              <p className="text-sm text-slate-600">{organizationLine(me.organization)}</p>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
            className="mt-2 flex h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold hover:bg-slate-100"
          >
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="flex h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold hover:bg-slate-100"
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
