// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from '../shared/ui';
import { StaffFieldStationsPage } from './StaffFieldStationsPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const org = (id: string, code: string, status: string) => ({
  id,
  code,
  legalName: `${code} Treks`,
  status,
  version: 1,
});

const station = (id: string, name: string, revokedAt: string | null = null) => ({
  id,
  name,
  mqttUsername: `fs-${id}`,
  createdAt: '2026-10-20T03:15:00.000Z',
  revokedAt,
  lastSyncAt: null,
  queueDepth: null,
  oldestRetryCount: 0,
  version: '1.2.0',
  outdated: false,
});

const serve = () =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint.startsWith('/organizations?'))
      return Promise.resolve({
        items: [org('org-a', 'ORG-0001', 'ACTIVE'), org('org-b', 'ORG-0002', 'SUSPENDED'), org('org-c', 'ORG-0003', 'PENDING')],
        totalCount: 3,
      });
    if (endpoint === '/organizations/org-a/field-stations')
      return Promise.resolve({ items: [station('fs-1', 'Office laptop'), station('fs-2', 'Old laptop', '2026-10-25T00:00:00.000Z')], limit: 5 });
    if (endpoint === '/organizations/org-b/field-stations') return Promise.resolve({ items: [station('fs-3', 'Base camp')], limit: 5 });
    if (options?.method === 'POST') return Promise.resolve(station('fs-1', 'Office laptop', '2026-11-01T00:00:00.000Z'));
    return Promise.reject(new Error(`unexpected ${endpoint}`));
  });

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <StaffFieldStationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('StaffFieldStationsPage (screen 3.5, TrekLink view)', () => {
  it('lists the stations of every active and suspended organization, never a pending one', async () => {
    serve();
    renderPage();
    const table = await screen.findByRole('table', { name: 'Field Stations of every organization' });
    expect(within(table).getByText('Office laptop')).toBeTruthy();
    expect(within(table).getByText('Base camp')).toBeTruthy();
    expect(api).not.toHaveBeenCalledWith('/organizations/org-c/field-stations');
    // A revoked row has no action.
    expect(screen.getByRole('button', { name: /Revoke\s+Office laptop of ORG-0001/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Revoke\s+Old laptop/ })).toBeNull();
  });

  it('says when more organizations exist than the one page it reads', async () => {
    api.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/organizations?'))
        return Promise.resolve({ items: [org('org-a', 'ORG-0001', 'ACTIVE')], totalCount: 101 });
      if (endpoint === '/organizations/org-a/field-stations')
        return Promise.resolve({ items: [station('fs-1', 'Office laptop')], limit: 5 });
      return Promise.reject(new Error(`unexpected ${endpoint}`));
    });
    renderPage();
    expect(await screen.findByText(/Showing the stations of the first 1 organizations; 100 more are not read here/)).toBeTruthy();
  });

  it('narrows to one organization through the filter', async () => {
    serve();
    renderPage();
    await screen.findByText('Base camp');
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'org-b' } });
    await waitFor(() => expect(screen.queryByText('Office laptop')).toBeNull());
    expect(screen.getByText('Base camp')).toBeTruthy();
  });

  it('revokes with the required reason and refetches', async () => {
    serve();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Revoke\s+Office laptop of ORG-0001/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Revoke Field Station Office laptop?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke Field Station' }));
    expect(await within(dialog).findByText('Enter a reason for this change.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Laptop stolen' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke Field Station' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/organizations/org-a/field-stations/fs-1/revoke', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Laptop stolen' }),
      }),
    );
    await waitFor(() => expect(useToast.getState().message).toBe('Field Station credential revoked'));
  });
});
