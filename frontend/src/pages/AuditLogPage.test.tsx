// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditFilters, AuditLogItem } from '../entities/audit/api';
import { ApiError } from '../shared/api/apiClient';
import { AuditLogPage } from './AuditLogPage';

const ACTOR = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';
const refetch = vi.fn();
const calls: { filters: AuditFilters; page: number }[] = [];
let state: {
  data?: { items: AuditLogItem[]; pageNumber: number; totalPages: number; totalCount: number };
  isPending: boolean;
  error: unknown;
};

vi.mock('../entities/audit/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/audit/api')>()),
  useAuditLogs: (filters: AuditFilters, page: number) => {
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

const entry = (overrides: Partial<AuditLogItem> = {}): AuditLogItem => ({
  id: 'a-1',
  actor: { id: ACTOR, fullName: 'Staff A' },
  actorRoles: ['STAFF'],
  organizationId: 'org-1',
  action: 'contract.approve',
  subjectType: 'RentalContract',
  subjectId: 'c0ffee00-1234',
  before: { status: 'REQUESTED' },
  after: { status: 'APPROVED' },
  requestId: 'req-8f2a',
  createdAt: '2026-10-20T03:15:00.000Z',
  ...overrides,
});

const Probe: React.FC = () => <p data-testid="search">{useLocation().search}</p>;

const renderPage = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/t/admin/audit/changes${search}`]}>
      <AuditLogPage />
      <Probe />
    </MemoryRouter>,
  );

const lastCall = () => calls[calls.length - 1];
// The table only: the phone card list renders beside it, with its own copy of the text.
const table = () => within(screen.getByRole('table', { name: 'Audit log' }));

beforeEach(() => {
  state = {
    data: { items: [entry()], pageNumber: 1, totalPages: 1, totalCount: 1 },
    isPending: false,
    error: null,
  };
});

afterEach(() => {
  cleanup();
  calls.length = 0;
  refetch.mockReset();
});

describe('AuditLogPage (screen 7.4, change log)', () => {
  it('shows time, actor with roles, the organization by name, action, subject and request id', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Filter by actor Staff A' })).toBeTruthy();
    expect(table().getByText('STAFF')).toBeTruthy();
    expect(table().getByText('Acme Trek')).toBeTruthy();
    expect(table().getByText('contract.approve')).toBeTruthy();
    expect(table().getByText('RentalContract')).toBeTruthy();
    expect(table().getByText('c0ffee00-1234')).toBeTruthy();
    expect(table().getByText('req-8f2a')).toBeTruthy();
    expect(lastCall()).toEqual({ filters: {}, page: 1 });
  });

  it('shows SYSTEM for an action with no actor and the id for an unknown organization', () => {
    state = {
      data: {
        items: [entry({ actor: null, actorRoles: [], organizationId: 'org-9', requestId: null })],
        pageNumber: 1,
        totalPages: 1,
        totalCount: 1,
      },
      isPending: false,
      error: null,
    };
    renderPage();
    expect(table().getByText('SYSTEM')).toBeTruthy();
    expect(table().getByText('org-9')).toBeTruthy();
  });

  it('opens already filtered from a link, such as the Changes link of a parameter', () => {
    renderPage('?action=parameter.&subjectId=monitoring.historyMaxRangeDays');
    expect(lastCall().filters).toEqual({
      action: 'parameter.',
      subjectId: 'monitoring.historyMaxRangeDays',
    });
    expect((screen.getByLabelText('Action starts with') as HTMLInputElement).value).toBe('parameter.');
    expect((screen.getByLabelText('Subject id') as HTMLInputElement).value).toBe(
      'monitoring.historyMaxRangeDays',
    );
  });

  it('lists the organizations by name for the filter', () => {
    renderPage();
    const options = Array.from(
      (screen.getByLabelText('Organization') as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toEqual(['All organizations', 'Acme Trek', 'Zeta Trek']);
  });

  it('writes the applied filters to the URL and drops the empty ones', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Action starts with'), { target: { value: ' contract. ' } });
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'org-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('search').textContent).toBe('?organizationId=org-1&action=contract.');
    expect(lastCall().filters).toEqual({ organizationId: 'org-1', action: 'contract.' });
  });

  it('blocks an actor that is not a UUID and an end before the start, and sends nothing', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Actor id'), { target: { value: 'staff-a' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-21T08:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-20T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Actor id must be a UUID.')).toBeTruthy();
    expect(screen.getByText('Choose an end after the start.')).toBeTruthy();
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('applies a period as ISO instants', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20T08:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-21T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const { from, to } = lastCall().filters;
    expect(Date.parse(to as string) - Date.parse(from as string)).toBe(86_400_000);
    expect(from).toMatch(/Z$/);
  });

  it('filters by the actor whose name is clicked, and clears all filters', () => {
    renderPage('?action=contract.');
    fireEvent.click(screen.getByRole('button', { name: 'Filter by actor Staff A' }));
    expect(lastCall().filters).toEqual({ action: 'contract.', actorId: ACTOR });
    expect((screen.getByLabelText('Actor id') as HTMLInputElement).value).toBe(ACTOR);
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(lastCall().filters).toEqual({});
  });

  it('shows and hides the before and after of an entry', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /^Show before and after of contract.approve/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(table().queryByText(/"status": "REQUESTED"/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(table().getByText(/"status": "REQUESTED"/)).toBeTruthy();
    expect(table().getByText(/"status": "APPROVED"/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(table().queryByText(/"status": "REQUESTED"/)).toBeNull();
  });

  it('offers the before and after behind Details on the phone card', () => {
    renderPage();
    expect(screen.getAllByText('Details').length).toBeGreaterThan(0);
  });

  it('pages the log and keeps the filters', () => {
    state = {
      data: { items: [entry()], pageNumber: 1, totalPages: 3, totalCount: 45 },
      isPending: false,
      error: null,
    };
    renderPage('?action=contract.');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByTestId('search').textContent).toBe('?action=contract.&page=2');
    expect(lastCall()).toEqual({ filters: { action: 'contract.' }, page: 2 });
  });

  it('says no result matches, and offers Clear filters only when a filter is set', () => {
    state = {
      data: { items: [], pageNumber: 1, totalPages: 1, totalCount: 0 },
      isPending: false,
      error: null,
    };
    renderPage();
    expect(screen.getByText('No results match your filters.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(1);
    cleanup();
    renderPage('?action=nothing.');
    expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(2);
  });

  it('shows a bad request as a banner without Retry, and a server error with Retry', () => {
    state = {
      isPending: false,
      error: new ApiError(400, 'VALIDATION_FAILED', 'from must be earlier than to.'),
    };
    renderPage();
    expect(screen.getByText('from must be earlier than to.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    cleanup();
    state = { isPending: false, error: new ApiError(500, 'INTERNAL_ERROR', 'The log is unavailable.') };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows MSG26 alone for a refused role', () => {
    state = { isPending: false, error: new ApiError(403, 'FORBIDDEN', 'No.') };
    renderPage();
    expect(screen.getByRole('alert').textContent).toBe('You do not have access to this.');
    expect(screen.queryByLabelText('Actor id')).toBeNull();
  });
});
