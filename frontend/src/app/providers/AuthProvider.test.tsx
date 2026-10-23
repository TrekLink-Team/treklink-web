// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { useSession, type SessionUser } from '../../entities/session/model';
import { AuthProvider } from './AuthProvider';

const tokens = {
  accessToken: 'a',
  accessTokenExpiresIn: 900,
  refreshToken: 'r',
  refreshTokenExpiresIn: 1209600,
};

const account = (id: string): SessionUser => ({
  id,
  email: `${id}@example.test`,
  fullName: id,
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  organization: null,
});

afterEach(() => {
  cleanup();
  useSession.getState().signOut();
});

describe('AuthProvider', () => {
  it('drops cached data when another account signs in or the session ends (AC-01)', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <span />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => useSession.getState().signIn(tokens, account('one')));
    queryClient.setQueryData(['incident', 'org-one'], { secret: true });

    act(() => useSession.getState().signIn(tokens, account('two')));
    expect(queryClient.getQueryData(['incident', 'org-one'])).toBeUndefined();

    queryClient.setQueryData(['incident', 'org-two'], { secret: true });
    act(() => useSession.getState().signOut());
    expect(queryClient.getQueryData(['incident', 'org-two'])).toBeUndefined();
  });
});
