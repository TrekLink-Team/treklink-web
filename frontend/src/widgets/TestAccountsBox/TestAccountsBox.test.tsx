// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '../../shared/api/apiClient';
import { useToast } from '../../shared/ui';
import { PlansPage } from '../../pages/PlansPage';
import { SignInPage } from '../../pages/SignInPage';
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

describe('the box on /sign-in and /', () => {
  it('fills the sign-in form when Use is pressed', async () => {
    serve(ACCOUNTS);
    wrap(<SignInPage />, ['/sign-in']);
    fireEvent.click(await screen.findByRole('button', { name: 'Use Org Operator' }));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('operator@treklink.local');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('Operator-Pass-4');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in' }));
  });

  it('shows the sign-in form alone when the route is a 404', async () => {
    serve(new ApiError(404, 'NOT_FOUND', 'Cannot GET /api/demo/accounts'));
    wrap(<SignInPage />, ['/sign-in']);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/demo/accounts'));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('Sandbox test accounts')).toBeNull();
  });

  it('carries the email, never the password, from / to /sign-in and fills the form there', async () => {
    serve(ACCOUNTS);
    let seen: { pathname: string; search: string; state: unknown } | null = null;
    const Spy: React.FC = () => {
      const location = useLocation();
      seen = { pathname: location.pathname, search: location.search, state: location.state };
      return <SignInPage />;
    };
    wrap(
      <Routes>
        <Route path="/" element={<PlansPage />} />
        <Route path="/sign-in" element={<Spy />} />
      </Routes>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Use Org Manager' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(seen).toEqual({
      pathname: '/sign-in',
      search: '',
      state: { demoEmail: 'manager@treklink.local' },
    });
    expect(JSON.stringify(seen)).not.toContain('Manager-Pass-3');
    await waitFor(() =>
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('Manager-Pass-3'),
    );
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('manager@treklink.local');
  });
});
