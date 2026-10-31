// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '../entities/session/model';
import { AuthProvider } from './providers/AuthProvider';
import { AppRoutes } from './router';

vi.mock('../pages/LiveMapPage', () => ({
  LiveMapPage: ({ scope }: { scope: string }) => <p>live map {scope}</p>,
}));
vi.mock('../pages/PlansPage', () => ({ PlansPage: () => <p>plans page</p> }));
vi.mock('../pages/ParametersPage', () => ({ ParametersPage: () => <p>parameters page</p> }));
vi.mock('../pages/AccountsPage', () => ({ AccountsPage: () => <p>accounts page</p> }));
vi.mock('../pages/AuditLogPage', () => ({ AuditLogPage: () => <p>audit log page</p> }));
vi.mock('../pages/AuthEventsPage', () => ({ AuthEventsPage: () => <p>sign-in events page</p> }));
vi.mock('../pages/ContractsPage', () => ({ ContractsPage: () => <p>contracts page</p> }));
vi.mock('../pages/InvoicesPage', () => ({
  InvoicesPage: () => <p>invoices page</p>,
  InvoiceDetailPage: () => <p>invoice page</p>,
}));
vi.mock('../pages/DesignSystemPage', () => ({ DesignSystemPage: () => <p>design system</p> }));
vi.mock('../pages/IncidentsPage', () => ({ IncidentsPage: () => <p>incident queue</p> }));
vi.mock('../pages/IncidentDetailPage', () => ({
  IncidentDetailPage: () => <p>incident detail</p>,
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

  it('keeps the page in `next` when the session expires', () => {
    visit('/t/map', account(['STAFF'], 'TREKLINK'));
    act(() => useSession.getState().signOut());
    expect(screen.getByText(/^sign-in \?next=%2Ft%2Fmap$/)).toBeTruthy();
  });

  it('adds no `next` after Sign out, which navigates to sign-in itself', () => {
    visit('/t/map', account(['STAFF'], 'TREKLINK'));
    act(() => useSession.getState().signOut(true));
    expect(screen.queryByText(/^sign-in/)).toBeNull();
  });

  it('shows MSG26 to an Org Operator who types a TrekLink route', () => {
    visit('/t/map', account(['ORG_OPERATOR'], 'ORGANIZATION'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
  });

  it('lets an Org Manager reach the map and the contracts', () => {
    visit('/o/map', account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('live map o')).toBeTruthy();
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

  it('gives the parameters page to an Admin only', () => {
    visit('/t/admin/parameters', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('parameters page')).toBeTruthy();
    cleanup();
    visit('/t/admin/parameters', account(['STAFF'], 'TREKLINK'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
    cleanup();
    visit('/t/admin/parameters', account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
    cleanup();
    act(() => useSession.getState().signOut());
    visit('/t/admin/parameters', null);
    expect(screen.getByText(/^sign-in \?next=%2Ft%2Fadmin%2Fparameters$/)).toBeTruthy();
  });

  it('gives the accounts page to an Admin only', () => {
    visit('/t/admin/accounts', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('accounts page')).toBeTruthy();
    cleanup();
    visit('/t/admin/accounts', account(['STAFF'], 'TREKLINK'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
  });

  it('gives the audit log to an Admin only and sends /t/admin/audit to it', () => {
    visit('/t/admin/audit/changes', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('audit log page')).toBeTruthy();
    cleanup();
    visit('/t/admin/audit', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('audit log page')).toBeTruthy();
    cleanup();
    visit('/t/admin/audit/changes', account(['STAFF'], 'TREKLINK'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
    cleanup();
    visit('/t/admin/audit/sign-ins', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('sign-in events page')).toBeTruthy();
    cleanup();
    visit('/t/admin/audit/sign-ins', account(['STAFF'], 'TREKLINK'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
    cleanup();
    act(() => useSession.getState().signOut());
    visit('/t/admin/audit/changes', null);
    expect(screen.getByText(/^sign-in \?next=%2Ft%2Fadmin%2Faudit%2Fchanges$/)).toBeTruthy();
  });

  it('lets an Admin reach /t/map', () => {
    visit('/t/map', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('live map t')).toBeTruthy();
  });

  it('shows the public plans page on `/` and `/plans`, to a visitor and to a signed-in user', () => {
    visit('/', null);
    expect(screen.getByText('plans page')).toBeTruthy();
    cleanup();
    visit('/plans', null);
    expect(screen.getByText('plans page')).toBeTruthy();
    cleanup();
    visit('/', account(['STAFF'], 'TREKLINK'));
    expect(screen.getByText('plans page')).toBeTruthy();
  });

  it('gives an Org Operator the incident queue and detail, and shows MSG26 to Staff', () => {
    visit('/o/incidents', account(['ORG_OPERATOR'], 'ORGANIZATION'));
    expect(screen.getByText('incident queue')).toBeTruthy();
    cleanup();
    visit('/o/incidents/inc-1', account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('incident detail')).toBeTruthy();
    cleanup();
    visit('/o/incidents', account(['STAFF'], 'TREKLINK'));
    expect(screen.getByText('You do not have access to this.')).toBeTruthy();
  });

  it('loads the design system page lazily in development', async () => {
    visit('/dev/design-system', null);
    expect(await screen.findByText('design system')).toBeTruthy();
  });

  it('has no design system route in a production build', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    try {
      const { AppRoutes: ProductionRoutes } = await import('./router');
      useSession.getState().signIn(tokens, account(['ADMIN'], 'TREKLINK'));
      render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={['/dev/design-system']}>
            <AuthProvider>
              <ProductionRoutes />
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(screen.getByText('You do not have access to this.')).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
