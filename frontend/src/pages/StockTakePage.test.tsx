// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { StockTakePage } from './StockTakePage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 10,
  totalCount: items.length,
  totalPages: 1,
});

const pastRun = {
  id: 'st-1',
  takenBy: 'Tran Thi B',
  createdAt: '2026-11-04T03:00:00.000Z',
  scannedCount: 12,
  unconfirmedCount: 2,
  unknownCount: 1,
};

const result = {
  id: 'st-2',
  createdAt: '2026-11-05T03:00:00.000Z',
  scannedCount: 2,
  inStockConfirmed: 1,
  rentedSeen: 4,
  unconfirmed: [{ id: 'd-31', assetTag: 'TL-0031', status: 'AVAILABLE', lastSeenAt: null }],
  unknownTags: ['TL-9999'],
};

const serve = (items: unknown[], respond: () => unknown = () => result) =>
  api.mockImplementation((_endpoint: string, options?: RequestInit) =>
    options?.method ? Promise.resolve().then(respond) : Promise.resolve(page(items)),
  );

const writes = () => api.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method);

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/stock-take']}>
        <StockTakePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const scan = (value: string) => {
  const field = screen.getByLabelText('Asset tag');
  fireEvent.change(field, { target: { value } });
  fireEvent.submit(field.closest('form')!);
};

beforeEach(() => {
  api.mockReset();
  sessionStorage.clear();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('StockTakePage (screen 4.5)', () => {
  it('lists past stock-takes with the taker and the counts', async () => {
    serve([pastRun]);
    renderPage();
    expect(await screen.findByText('Tran Thi B')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/stock-takes?pageNumber=1&pageSize=10');
    expect(screen.getByText("Scan a device's asset tag to start.")).toBeTruthy();
  });

  it('shows the empty past list', async () => {
    serve([]);
    renderPage();
    expect(await screen.findByText('No stock-takes yet.')).toBeTruthy();
  });

  it('upper-cases scans, ignores a duplicate with a note, announces each tag and keeps focus in the field', async () => {
    serve([]);
    renderPage();
    const field = screen.getByLabelText('Asset tag');
    expect(document.activeElement).toBe(field);
    scan(' tl-0042 ');
    scan('TL-0043');
    scan('TL-0042');
    const list = within(screen.getByRole('list', { name: 'Scanned tags' }));
    expect(list.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('TL-0042: Already scanned')).toBeTruthy();
    expect(screen.getByText('2 scanned')).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem('treklink.stockTake.scans') ?? '[]')).toEqual([
      'TL-0043',
      'TL-0042',
    ]);
    fireEvent.click(list.getByRole('button', { name: 'Remove TL-0043' }));
    expect(screen.getByText('TL-0043 removed, 1 scanned')).toBeTruthy();
  });

  it('restores the scan list after a reload from session storage', () => {
    sessionStorage.setItem('treklink.stockTake.scans', JSON.stringify(['TL-0007']));
    serve([]);
    renderPage();
    expect(within(screen.getByRole('list', { name: 'Scanned tags' })).getByText('TL-0007')).toBeTruthy();
  });

  it('submits after the confirmation and shows the four groups, Unconfirmed first and focused', async () => {
    serve([]);
    renderPage();
    scan('TL-0001');
    scan('TL-9999');
    fireEvent.click(screen.getByRole('button', { name: 'Finish stock-take' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Submit 2 tags?' }));
    fireEvent.click(confirm.getByRole('button', { name: 'Finish stock-take' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/stock-takes');
    expect(JSON.parse(String((writes()[0][1] as RequestInit).body))).toEqual({
      scannedTags: ['TL-0001', 'TL-9999'],
    });
    const heading = await screen.findByRole('heading', { name: 'Unconfirmed (1)' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent);
    expect(headings).toEqual([
      'Unconfirmed (1)',
      'Unknown tags (1)',
      'In stock, confirmed by scan (1)',
      'Rented and heard recently (4)',
    ]);
    expect(screen.getByRole('link', { name: 'TL-0031' }).getAttribute('href')).toBe('/t/devices/d-31');
    expect(sessionStorage.getItem('treklink.stockTake.scans')).toBeNull();
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
  });

  it('keeps the list and shows the server message when the submit fails', async () => {
    serve([], () => {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Scan at least one asset tag.');
    });
    renderPage();
    scan('TL-0001');
    fireEvent.click(screen.getByRole('button', { name: 'Finish stock-take' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Submit 1 tag?' }));
    fireEvent.click(confirm.getByRole('button', { name: 'Finish stock-take' }));
    expect(await screen.findByText('Scan at least one asset tag.')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Scanned tags' })).getByText('TL-0001')).toBeTruthy();
  });

  it('shows MSG26 for an organization account', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You do not have access to this.'));
    renderPage();
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
  });
});
