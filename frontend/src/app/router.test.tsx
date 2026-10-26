// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '../entities/session/model';
import { AuthProvider } from './providers/AuthProvider';
import { AppRoutes } from './router';

vi.mock('../pages/DashboardPage', () => ({ DashboardPage: () => <p>interim dashboard</p> }));
vi.mock('../pages/ContractsPage', () => ({ ContractsPage: () => <p>contracts page</p> }));
vi.mock('../pages/InvoicesPage', () => ({
  InvoicesPage: () => <p>invoices page</p>,
  InvoiceDetailPage: () => <p>invoice page</p>,
}));
vi.mock('../pages/ContractApprovalPage', () => ({
  ContractApprovalPage: () => <p>approval queue</p>,
}));
vi.mock('../pages/SignInPage', () => ({
  SignInPage: () => {
    const location = useLocation();
    return <p>sign-in {location.search}</p>;
  },
}));

const tokens = {
  accessToken: 'a',
  accessTokenExpiresIn: 900,
  refreshToken: 'r',
  refreshTokenExpiresIn: 1209600,
};

const account = (roles: string[], accountType: SessionUser['accountType']): SessionUser => ({
  id: roles[0],
  email: 'user@example.test',
  fullName: 'User',
  accountType,
  roles,
  organization: null,
});

const visit = (path: string, user: SessionUser | null) => {
  if (user) useSession.getState().signIn(tokens, user);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  act(() => useSession.getState().signOut());
});

describe('route guards (AC-01)', () => {
  it('sends an anonymous visitor to sign-in with the page they asked for', () => {
    visit('/t/map', null);
    expect(screen.getByText(/^sign-in \?next=%2Ft%2Fmap$/)).toBeTruthy();
  });

  it('shows MSG26 to an Org Operator who types a TrekLink route', () => {
    visit('/t/map', account(['ORG_OPERATOR'], 'ORGANIZATION'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
  });

  it('lets an Org Manager reach the map and the contracts', () => {
    visit('/o/map', account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('interim dashboard')).toBeTruthy();
    cleanup();
    visit('/o/contracts', account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('contracts page')).toBeTruthy();
  });

  it('keeps invoices for the Org Manager and shows MSG26 to an Org Operator', () => {
    visit('/o/invoices', account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('invoices page')).toBeTruthy();
    cleanup();
    visit('/o/invoices', account(['ORG_OPERATOR'], 'ORGANIZATION'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
  });

  it('gives TrekLink Staff the approval queue', () => {
    visit('/t/contracts', account(['STAFF'], 'TREKLINK'));
    expect(screen.getByText('approval queue')).toBeTruthy();
  });

  it('sends a signed-in user on /sign-in to the same-origin next path', () => {
    visit('/sign-in?next=%2Fo%2Finvoices', account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('invoices page')).toBeTruthy();
  });

  it('lets an Admin reach /t/map', () => {
    visit('/t/map', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('interim dashboard')).toBeTruthy();
  });
});
