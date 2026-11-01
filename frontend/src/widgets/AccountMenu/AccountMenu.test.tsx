// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '../../entities/session/model';
import { SignInPage } from '../../pages/SignInPage';
import { apiClient, ApiError } from '../../shared/api/apiClient';
import { AccountMenu } from './AccountMenu';
import { DISCARD_PROMPT, initialsOf, roleLabel } from './labels';

vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: vi.fn(),
}));

const TOKENS = {
  accessToken: 'a',
  accessTokenExpiresIn: 900,
  refreshToken: 'rt_current',
  refreshTokenExpiresIn: 1209600,
};

const STAFF: SessionUser = {
  id: 'staff-1',
  email: 'staff@treklink.vn',
  fullName: 'Tran Thi B',
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  organization: null,
};

const MANAGER: SessionUser = {
  id: 'manager-1',
  email: 'manager@acme-trek.vn',
  fullName: 'Nguyen Van A',
  accountType: 'ORGANIZATION',
  roles: ['ORG_MANAGER'],
  organization: {
    id: 'org-1',
    code: 'ORG-0007',
    legalName: 'ACME Trek Co., Ltd.',
    status: 'ACTIVE',
    memberRole: 'MANAGER',
  },
};

const api = vi.mocked(apiClient);

// Answers each endpoint the way the server does; `answers` overrides one.
const serve = (me: SessionUser, answers: Record<string, () => Promise<unknown>> = {}) =>
  api.mockImplementation((endpoint: string) =>
    (answers[endpoint] ?? (() => Promise.resolve(endpoint === '/auth/me' ? me : null)))() as never,
  );

const show = (user: SessionUser | null) => {
  if (user) act(() => useSession.getState().signIn(TOKENS, user));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/t/map']}>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="*" element={<AccountMenu />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const accountButton = () => screen.getByRole('button', { name: /^Account/ });

const openMenu = () => fireEvent.click(accountButton());

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const openDialog = () => {
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Change password' }));
};

beforeEach(() => serve(STAFF));

afterEach(() => {
  cleanup();
  api.mockReset();
  vi.restoreAllMocks();
  act(() => useSession.getState().signOut());
});

describe('account menu (screen 2.2)', () => {
  it('shows nothing while signed out', () => {
    show(null);
    expect(screen.queryByRole('button', { name: /^Account/ })).toBeNull();
  });

  it('shows the name and initials, and the read-only profile from auth 04', async () => {
    show(STAFF);

    expect(accountButton().textContent).toContain('TB');
    expect(accountButton().getAttribute('aria-haspopup')).toBe('menu');
    expect(accountButton().getAttribute('aria-expanded')).toBe('false');
    openMenu();

    expect(accountButton().getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('staff@treklink.vn');
    expect(menu.textContent).toContain('Staff');
    expect(menu.textContent).not.toContain('ORG-');
    await waitFor(() => expect(api).toHaveBeenCalledWith('/auth/me'));
  });

  it('adds the organization line for an organization account', () => {
    serve(MANAGER);
    show(MANAGER);
    openMenu();

    expect(screen.getByRole('menu').textContent).toContain('ACME Trek Co., Ltd. (ORG-0007), ACTIVE');
    expect(screen.getByRole('menu').textContent).toContain('Org Manager');
  });

  it('moves through the items with the arrow keys, and Escape returns focus to the button', () => {
    show(STAFF);
    openMenu();
    const [change, signOut] = screen.getAllByRole('menuitem');

    expect(document.activeElement).toBe(change);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(signOut);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(change);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(signOut);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(accountButton());
  });

  it('closes when a pointer is pressed outside, and stays open for a press inside', () => {
    show(STAFF);
    openMenu();

    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(accountButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when focus leaves the menu, and stays open while it moves between items', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    show(STAFF);
    openMenu();
    const [change, signOut] = screen.getAllByRole('menuitem');

    fireEvent.blur(change, { relatedTarget: signOut });
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.blur(signOut, { relatedTarget: outside });
    expect(screen.queryByRole('menu')).toBeNull();
    outside.remove();
  });

  it.each([
    ['answers', () => Promise.resolve(null)],
    ['fails', () => Promise.reject(new Error('offline'))],
  ])('signs out with the refresh token when the server %s (auth 03)', async (_label, answer) => {
    serve(STAFF, { '/auth/logout': answer });
    show(STAFF);
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    });

    expect(api).toHaveBeenCalledWith('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'rt_current' }),
    });
    expect(useSession.getState().tokens).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('change-password dialog (auth 08)', () => {
  const fill = (confirm = 'brand-new-password') => {
    type('Current password', 'old-password');
    type('New password', 'brand-new-password');
    type('Confirm new password', confirm);
  };

  it('starts on Current password and keeps Tab inside the dialog', () => {
    show(STAFF);
    openDialog();

    const dialog = screen.getByRole('dialog', { name: 'Change password' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Current password'));

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('Current password'));
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('refuses different passwords in the browser without sending', async () => {
    show(STAFF);
    openDialog();
    fill('something-else');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('Passwords do not match.');
    expect(api).not.toHaveBeenCalledWith('/auth/password/change', expect.anything());
  });

  it.each([
    ['INVALID_CREDENTIALS', 'The current password is incorrect.', 'change-current-error'],
    ['PASSWORD_POLICY', 'password must be at least 8 characters.', 'change-password-error'],
  ])('shows %s under its field and keeps every field', async (code, message, errorId) => {
    serve(STAFF, { '/auth/password/change': () => Promise.reject(new ApiError(400, code, message)) });
    show(STAFF);
    openDialog();
    fill();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    });

    expect(document.getElementById(errorId)?.textContent).toBe(message);
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('old-password');
  });

  it('shows any other refusal above the form', async () => {
    serve(STAFF, { '/auth/password/change': () => Promise.reject(new Error('offline')) });
    show(STAFF);
    openDialog();
    fill();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Please try again.');
  });

  it('changes the password, then signs out to /sign-in with the banner (D-063 rule 1)', async () => {
    show(STAFF);
    openDialog();
    fill();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    });

    expect(api).toHaveBeenCalledWith('/auth/password/change', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'brand-new-password' }),
    });
    expect(api).toHaveBeenCalledWith('/auth/logout', expect.anything());
    expect(useSession.getState().tokens).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Password changed');
  });

  it('asks before discarding filled fields, and closes at once when empty', () => {
    const confirm = vi.spyOn(window, 'confirm');
    show(STAFF);
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(accountButton());

    openDialog();
    type('Current password', 'old-password');
    confirm.mockReturnValueOnce(false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(confirm).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(screen.getByRole('dialog')).toBeTruthy();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('AccountMenu demo role switch (D-088, screen 7.5)', () => {
  beforeEach(() => {
    api.mockReset();
    act(() => useSession.getState().signOut());
  });
  afterEach(() => cleanup());

  const ADMIN_SESSION = {
    ...TOKENS,
    accessToken: 'admin-token',
    user: { ...STAFF, id: 'admin-1', email: 'admin@treklink.local', roles: ['ADMIN'] },
  };

  it('offers no role switch while demo mode is off (the status route is a 404)', async () => {
    serve(MANAGER, {
      '/demo/status': () => Promise.reject(new ApiError(404, 'NOT_FOUND', 'Cannot GET /api/demo/status')),
    });
    show(MANAGER);
    fireEvent.click(await screen.findByRole('button', { name: /Account/ }));
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(screen.queryByRole('group', { name: 'Switch role' })).toBeNull();
  });

  it('lets a Manager switch back to the Admin while demo mode is on', async () => {
    serve(MANAGER, {
      '/demo/status': () => Promise.resolve({ enabled: true, databaseLocal: true, lastStaged: null }),
      '/demo/switch-role': () => Promise.resolve(ADMIN_SESSION),
    });
    show(MANAGER);
    fireEvent.click(await screen.findByRole('button', { name: /Account/ }));
    const admin = await screen.findByRole('menuitem', { name: 'Admin' });
    expect(screen.getByRole('menuitem', { name: 'Manager' }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(admin);
    await waitFor(() => expect(useSession.getState().user?.email).toBe('admin@treklink.local'));
    expect(api).toHaveBeenCalledWith('/demo/switch-role', {
      method: 'POST',
      body: JSON.stringify({ role: 'ADMIN' }),
    });
    expect(useSession.getState().tokens?.accessToken).toBe('admin-token');
  });

  it('shows a refused switch in the menu', async () => {
    serve(MANAGER, {
      '/demo/status': () => Promise.resolve({ enabled: true, databaseLocal: false, lastStaged: null }),
      '/demo/switch-role': () =>
        Promise.reject(
          new ApiError(403, 'DEMO_DATABASE_NOT_LOCAL', 'Demo controls run only against a local database.'),
        ),
    });
    show(MANAGER);
    fireEvent.click(await screen.findByRole('button', { name: /Account/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Staff' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Demo controls run only against a local database.',
    );
    expect(useSession.getState().user?.id).toBe('manager-1');
  });
});

describe('labels', () => {
  it('names every role and passes an unknown key through', () => {
    expect(roleLabel(['ADMIN', 'ORG_OPERATOR', 'AUDITOR'])).toBe('Admin, Org Operator, AUDITOR');
  });

  it('takes the initials of the last two names', () => {
    expect(initialsOf('Nguyen  Van An')).toBe('VA');
    expect(initialsOf('admin')).toBe('A');
  });
});
