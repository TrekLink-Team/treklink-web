// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '../../shared/api/apiClient';
import { useToast } from '../../shared/ui';
import { PlansPage } from '../../pages/PlansPage';
import { SignInPage } from '../../pages/SignInPage';
import { DemoSignInPage } from '../../pages/DemoSignInPage';
import { useSession } from '../../entities/session/model';
import { TestAccountsBox } from './TestAccountsBox';

vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: vi.fn(),
}));

vi.mock('../../app/providers/useAuth', () => ({ useAuth: () => ({ user: null }) }));

const api = vi.mocked(apiClient);

const ACCOUNTS = [
  ['ADMIN', 'TrekLink Admin', 'admin@treklink.local', 'Admin-Pass-1', 'Demo Admin', null],
  ['STAFF', 'TrekLink Staff', 'staff@treklink.local', 'Staff-Pass-2', 'Demo Staff', null],
  ['ORG_MANAGER', 'Org Manager', 'manager@treklink.local', 'Manager-Pass-3', 'Demo Manager', 'ORG-0001'],
  ['ORG_OPERATOR', 'Org Operator', 'operator@treklink.local', 'Operator-Pass-4', 'Demo Operator', 'ORG-0001'],
].map(([role, roleLabel, email, password, fullName, organization]) => ({
  role,
  roleLabel,
  email,
  password,
  fullName,
  organization,
}));

// Answers the accounts route; every other route (the plans of `/`) never settles.
const serve = (accounts: unknown) =>
  api.mockImplementation((path: string) =>
    path === '/demo/accounts'
      ? accounts instanceof Error
        ? Promise.reject(accounts)
        : Promise.resolve({ accounts })
      : new Promise(() => undefined),
  );

const wrap = (ui: React.ReactNode, initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries'] = ['/']) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  api.mockReset();
  useToast.getState().dismiss();
  useSession.getState().signOut();
});

describe('TestAccountsBox (screen 7.5 box, demo api-design 05)', () => {
  it('renders nothing when the route is a 404', async () => {
    serve(new ApiError(404, 'NOT_FOUND', 'Cannot GET /api/demo/accounts'));
    const { container } = wrap(<TestAccountsBox onUse={() => undefined} />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/demo/accounts'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing on any other error', async () => {
    serve(new ApiError(500, 'INTERNAL', 'boom'));
    const { container } = wrap(<TestAccountsBox onUse={() => undefined} />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe('');
  });

  it('renders a row per account with the note, role, email and password', async () => {
    serve(ACCOUNTS);
    wrap(<TestAccountsBox onUse={() => undefined} />);
    const card = await screen.findByRole('region', { name: 'Sandbox test accounts' });
    expect(
      within(card).getByText('Fictitious demo data. Anyone with this page can sign in as any role.'),
    ).toBeTruthy();
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('TrekLink Admin')).toBeTruthy();
    expect(within(rows[0]).getByText('Demo Admin, TrekLink')).toBeTruthy();
    expect(within(rows[2]).getByText('Demo Manager, ORG-0001')).toBeTruthy();
    expect(within(rows[3]).getByText('operator@treklink.local')).toBeTruthy();
    expect(within(rows[3]).getByText('Operator-Pass-4')).toBeTruthy();
  });

  it('copies a password and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    serve(ACCOUNTS);
    wrap(<TestAccountsBox onUse={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy password for Org Manager' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Manager-Pass-3'));
    expect(useToast.getState().message).toBe('Copied.');
  });

  it('hands the chosen account to onUse', async () => {
    const onUse = vi.fn();
    serve(ACCOUNTS);
    wrap(<TestAccountsBox onUse={onUse} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use TrekLink Staff' }));
    expect(onUse).toHaveBeenCalledWith(ACCOUNTS[1]);
  });
});

describe('the /demo page and the clean sign-in page (leader, 2026-11-13)', () => {
  it('signs in at once as the chosen account and lands on its home', async () => {
    const user = {
      id: 'u-staff',
      email: 'staff@treklink.local',
      fullName: 'Demo Staff',
      accountType: 'TREKLINK',
      roles: ['STAFF'],
      organization: null,
    };
    api.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/demo/accounts') return Promise.resolve({ accounts: ACCOUNTS });
      if (path === '/auth/login') {
        expect(JSON.parse(String(init?.body))).toEqual({
          email: 'staff@treklink.local',
          password: 'Staff-Pass-2',
        });
        return Promise.resolve({ accessToken: 'a', refreshToken: 'r', user });
      }
      return new Promise(() => undefined);
    });
    wrap(
      <Routes>
        <Route path="/demo" element={<DemoSignInPage />} />
        <Route path="/t/map" element={<p>Staff home</p>} />
      </Routes>,
      ['/demo'],
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in as TrekLink Staff' }));
    expect(await screen.findByText('Staff home')).toBeTruthy();
    expect(useSession.getState().user?.email).toBe('staff@treklink.local');
  });

  it('shows the server message when the quick sign-in is refused', async () => {
    api.mockImplementation((path: string) =>
      path === '/demo/accounts'
        ? Promise.resolve({ accounts: ACCOUNTS })
        : path === '/auth/login'
          ? Promise.reject(new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'))
          : new Promise(() => undefined),
    );
    wrap(<DemoSignInPage />, ['/demo']);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in as Org Operator' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in as Org Operator' })).toHaveProperty('disabled', false);
  });

  it('offers a retry, not "off", when the read fails for another reason', async () => {
    serve(new ApiError(500, 'INTERNAL', 'Internal server error'));
    wrap(<DemoSignInPage />, ['/demo']);
    expect(await screen.findByText('The demo accounts could not be loaded. Try again.')).toBeTruthy();
    expect(screen.queryByText('Demo sign-in is off on this deployment.')).toBeNull();
  });

  it('says demo sign-in is off when the route is a 404', async () => {
    serve(new ApiError(404, 'NOT_FOUND', 'Cannot GET /api/demo/accounts'));
    wrap(<DemoSignInPage />, ['/demo']);
    expect(await screen.findByText('Demo sign-in is off on this deployment.')).toBeTruthy();
    expect(screen.queryByText('Sandbox test accounts')).toBeNull();
  });

  it('keeps the sign-in page and / free of the test accounts even when they are listed', async () => {
    serve(ACCOUNTS);
    wrap(<SignInPage />, ['/sign-in']);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    cleanup();
    wrap(<PlansPage />, ['/']);
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByText('Sandbox test accounts')).toBeNull();
    expect(api).not.toHaveBeenCalledWith('/demo/accounts');
  });
});
