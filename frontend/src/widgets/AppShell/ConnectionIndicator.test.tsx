// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../entities/session/model';
import { ConnectionIndicator } from './ConnectionIndicator';

beforeEach(() => {
  useSession.setState({
    user: {
      id: 'u-1',
      email: 'operator@example.invalid',
      fullName: 'Operator',
      roles: ['ORG_OPERATOR'],
      accountType: 'ORGANIZATION',
      organization: null,
    },
  });
});
afterEach(() => {
  cleanup();
  useSession.getState().signOut();
  vi.unstubAllEnvs();
});

describe('ConnectionIndicator', () => {
  it('says Live with a socket', () => {
    render(<ConnectionIndicator />);
    expect(screen.getByTitle('Live updates: Live')).toBeTruthy();
  });

  it('says Auto refresh in poll mode instead of Reconnecting (D-089)', () => {
    vi.stubEnv('VITE_LIVE_MODE', 'poll');
    render(<ConnectionIndicator />);
    expect(screen.getByTitle('Live updates: Auto refresh')).toBeTruthy();
  });
});
