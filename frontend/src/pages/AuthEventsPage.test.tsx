// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthEventFilters, AuthEventItem } from '../entities/auth-event/api';
import { ApiError } from '../shared/api/apiClient';
import { AuthEventsPage } from './AuthEventsPage';

const USER = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';
const refetch = vi.fn();
const calls: { filters: AuthEventFilters; page: number }[] = [];
let state: {
  data?: { items: AuthEventItem[]; pageNumber: number; totalPages: number; totalCount: number };
  isPending: boolean;
  error: unknown;
};

vi.mock('../entities/auth-event/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/auth-event/api')>()),
  useAuthEvents: (filters: AuthEventFilters, page: number) => {
    calls.push({ filters, page });
    return { ...state, refetch };
  },
}));

vi.mock('../entities/organization/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/organization/api')>()),
  useOrganizations: () => ({
    data: {
      items: [
        { id: 'org-2', legalName: 'Zeta Trek' },
        { id: 'org-1', legalName: 'Acme Trek' },
      ],
      totalCount: 2,
    },
  }),
}));

vi.mock('../entities/account/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/account/api')>()),
  useAccounts: () => ({ data: undefined }),
}));

const event = (overrides: Partial<AuthEventItem> = {}): AuthEventItem => ({
  id: 'e-1',
  userId: USER,
  email: 'manager@acme-trek.vn',
  organization: { id: 'org-1', name: 'Acme Trek' },
  type: 'LOGIN_FAILED',
  ip: '203.0.113.7',
  createdAt: '2026-10-20T03:15:00.000Z',
  ...overrides,
});

const Probe: React.FC = () => <p data-testid="search">{useLocation().search}</p>;

const renderPage = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/t/admin/audit/sign-ins${search}`]}>
      <AuthEventsPage />
      <Probe />
    </MemoryRouter>,
  );

const lastCall = () => calls[calls.length - 1];
// The table only: the phone card list renders beside it, with its own copy of the text.
const table = () => within(screen.getByRole('table', { name: 'Sign-in events' }));

beforeEach(() => {
  state = {
    data: { items: [event()], pageNumber: 1, totalPages: 1, totalCount: 1 },
    isPending: false,
    error: null,
  };
});

afterEach(() => {
  cleanup();
  calls.length = 0;
  refetch.mockReset();
});

describe('AuthEventsPage (screen 7.3, sign-in events)', () => {
  it('shows event type, email, organization and IP, and announces the count', () => {
    renderPage();
    expect(table().getByText('LOGIN_FAILED')).toBeTruthy();
    expect(table().getByText('manager@acme-trek.vn')).toBeTruthy();
    expect(table().getByText('Acme Trek')).toBeTruthy();
    expect(table().getByText('203.0.113.7')).toBeTruthy();
    expect(screen.getByText('1 event').getAttribute('aria-live')).toBe('polite');
    expect(lastCall()).toEqual({ filters: {}, page: 1 });
  });

  it('shows None for an attempt that matched no account and gives the row no account link', () => {
    state = {
      data: {
        items: [event({ userId: null, organization: null, email: 'ghost@x.vn' })],
        pageNumber: 1,
        totalPages: 1,
        totalCount: 1,
      },
      isPending: false,
      error: null,
    };
    renderPage();
    expect(table().getByText('None')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Filter by the account/ })).toBeNull();
  });

  it('badges a security signal with its text and leaves other events plain', () => {
    state = {
      data: {
        items: [
          event({ id: 'e-2', type: 'TOKEN_REUSE_DETECTED' }),
          event({ id: 'e-3', type: 'LOGOUT' }),
        ],
        pageNumber: 1,
        totalPages: 1,
        totalCount: 2,
      },
      isPending: false,
      error: null,
    };
    renderPage();
    const signal = table().getByText('TOKEN_REUSE_DETECTED').parentElement!;
    const plain = table().getByText('LOGOUT').parentElement!;
    expect(signal.className).toMatch(/critical/);
    expect(plain.className).not.toMatch(/critical/);
  });

  it('opens already filtered from a link and lists the 11 event types', () => {
    renderPage(`?userId=${USER}&type=LOGIN_FAILED`);
    expect(lastCall().filters).toEqual({ userId: USER, type: 'LOGIN_FAILED' });
    const select = screen.getByLabelText('Event type') as HTMLSelectElement;
    expect(select.value).toBe('LOGIN_FAILED');
    expect(select.options).toHaveLength(12);
  });

  it('lists the organizations by name for the filter', () => {
    renderPage();
    const options = Array.from(
      (screen.getByLabelText('Organization') as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toEqual(['All organizations', 'Acme Trek', 'Zeta Trek']);
  });

  it('writes the applied filters to the URL', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Event type'), { target: { value: 'ACCOUNT_LOCKED' } });
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'org-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('search').textContent).toBe(
      '?organizationId=org-1&type=ACCOUNT_LOCKED',
    );
    expect(lastCall().filters).toEqual({ organizationId: 'org-1', type: 'ACCOUNT_LOCKED' });
  });

  it('filters by the account of a row', () => {
    renderPage();
    fireEvent.click(
      screen.getByRole('button', { name: 'Filter by the account of manager@acme-trek.vn' }),
    );
    expect(screen.getByTestId('search').textContent).toBe(`?userId=${USER}`);
  });

  it('blocks an end before the start with the message under To and sends nothing', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-02T08:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Choose an end after the start.')).toBeTruthy();
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('clears the filters', () => {
    renderPage('?type=LOGOUT');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('shows the empty message when a filtered page has no rows', () => {
    state = {
      data: { items: [], pageNumber: 1, totalPages: 0, totalCount: 0 },
      isPending: false,
      error: null,
    };
    renderPage('?type=LOGOUT');
    expect(screen.getAllByText('No results match your filters.').length).toBeGreaterThan(0);
  });

  it('shows MSG26 alone for a 403', () => {
    state = { isPending: false, error: new ApiError(403, 'FORBIDDEN', 'Forbidden') };
    renderPage();
    expect(screen.getByRole('alert').textContent).toBe('You do not have access to this.');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the server message for a 400 without a Retry', () => {
    state = {
      isPending: false,
      error: new ApiError(400, 'VALIDATION_FAILED', 'userId must be a UUID.'),
    };
    renderPage();
    expect(screen.getByText('userId must be a UUID.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('draws the audit links with Sign-ins as the current page', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Sign-ins' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Change log' }).getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'Change log' }).getAttribute('href')).toBe(
      '/t/admin/audit/changes',
    );
  });

  it('says event for one row and events for several', () => {
    renderPage();
    expect(screen.getByText('1 event')).toBeTruthy();
    cleanup();
    state = {
      data: { items: [event(), event({ id: 'e-2' })], pageNumber: 1, totalPages: 1, totalCount: 2 },
      isPending: false,
      error: null,
    };
    renderPage();
    expect(screen.getByText('2 events')).toBeTruthy();
  });

  it('shows the time in UTC on hover without a doubled zone', () => {
    renderPage();
    const time = table().getByText(/Oct 2026/);
    expect(time.getAttribute('title')).toBe('20 Oct 2026, 03:15:00 UTC');
  });

  it('refetches from Refresh', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the result count after Apply', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(document.activeElement).toBe(screen.getByText('1 event'));
  });

  it('keeps the filters behind a Filters button that toggles them', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('auth-events-filter-bar')!.className).toContain('hidden');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('auth-events-filter-bar')!.className).not.toContain('hidden ');
  });

  it('names an account chosen from a link by the email of its row', () => {
    renderPage(`?userId=${USER}`);
    expect((screen.getByLabelText('Account') as HTMLInputElement).value).toBe(
      'manager@acme-trek.vn',
    );
  });

  describe('paging', () => {
    const several = (pageNumber: number) => ({
      data: {
        items: [event()],
        pageNumber,
        totalPages: 3,
        totalCount: 41,
      },
      isPending: false,
      error: null,
    });

    it('reads the page from the URL and treats a bad value as page 1', () => {
      state = several(2);
      renderPage('?page=2');
      expect(lastCall().page).toBe(2);
      cleanup();
      renderPage('?page=abc');
      expect(lastCall().page).toBe(1);
    });

    it('writes the page to the URL and keeps the filters', () => {
      state = several(1);
      renderPage('?type=LOGOUT');
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(screen.getByTestId('search').textContent).toBe('?type=LOGOUT&page=2');
    });

    it('goes back to page 1 when the filters are applied', () => {
      state = several(2);
      renderPage('?type=LOGOUT&page=2');
      fireEvent.change(screen.getByLabelText('Event type'), { target: { value: 'LOGIN_FAILED' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(screen.getByTestId('search').textContent).toBe('?type=LOGIN_FAILED');
      expect(lastCall().page).toBe(1);
    });
  });
});
