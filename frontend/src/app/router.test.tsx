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
vi.mock('../pages/SignInPage', () => ({
  SignInPage: () => {
    const location = useLocation();
    return <p>sign-in {location.search}</p>;
  },
}));

const tokens = { accessToken: 'a', accessTokenExpiresIn: 900, refreshToken: 'r', refreshTokenExpiresIn: 1209600 };

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

  it.each(['/o/map', '/o/contracts'])('lets an Org Manager reach %s', (path) => {
    visit(path, account(['ORG_MANAGER'], 'ORGANIZATION'));
    expect(screen.getByText('interim dashboard')).toBeTruthy();
  });

  it('lets an Admin reach /t/map', () => {
    visit('/t/map', account(['ADMIN'], 'TREKLINK'));
    expect(screen.getByText('interim dashboard')).toBeTruthy();
  });
});
