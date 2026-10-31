// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { LossCasePage } from './LossCasePage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

let viewer = { id: 'staff-1', roles: ['STAFF'] };
vi.mock('../app/providers/useAuth', () => ({ useAuth: () => ({ user: viewer }) }));

const DETAIL = '/loss-cases/lc-1';

const theCase = (overrides: Record<string, unknown> = {}) => ({
  id: 'lc-1',
  code: 'LOSS-0003',
  device: { id: 'dev-1', assetTag: 'TL-0042' },
  state: 'REPORTED',
  stateFromDevice: 'RENTED',
  reportedAt: '2026-10-20T03:15:00.000Z',
  description: 'Last seen at Phan Dung camp',
  lastSeenAt: '2026-10-20T03:15:00.000Z',
  lastPosition: { lat: 11.5544, lon: 108.5381 },
  custody: null,
  contractDeviceId: 'cd-77',
  organization: { id: 'org-1', code: 'ORG-0007' },
  keyExposed: false,
  suspectedTheft: false,
  policeReference: null,
  searchEndsAt: null,
  triagedById: null,
  decision: null,
  chargeVnd: null,
  version: 0,
  ...overrides,
});

const serve = (
  detail: () => unknown,
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint === DETAIL && !options?.method) return Promise.resolve(detail());
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const bodyOf = (options?: RequestInit) => JSON.parse((options?.body as string) ?? '{}') as unknown;

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/loss-cases/lc-1']}>
        <Routes>
          <Route path="/t/loss-cases/:id" element={<LossCasePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  viewer = { id: 'staff-1', roles: ['STAFF'] };
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('LossCasePage (screen 4.4)', () => {
  it('shows a REPORTED case with Triage and Record recovery, and no Confirm or Settle', async () => {
    serve(() => theCase());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'LOSS-0003, Reported' })).toBeTruthy();
    expect(screen.getByText('Last seen at Phan Dung camp')).toBeTruthy();
    expect(screen.getByText('11.55440, 108.53810')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Triage' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record recovery' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm loss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settle' })).toBeNull();
  });

  it('triages with the suspected theft flag and the police reference, then toasts MSG03', async () => {
    // The server's state: the refetch after the action reads the triaged case.
    let current = theCase();
    serve(
      () => current,
      (endpoint, options) => {
        expect(endpoint).toBe('/loss-cases/lc-1/triage');
        expect(bodyOf(options)).toEqual({
          suspectedTheft: true,
          policeReference: 'CA-PD-2026-118',
          expectedVersion: 0,
        });
        current = theCase({ state: 'SEARCHING', custody: 'RENTER', keyExposed: true, version: 1 });
        return current;
      },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'LOSS-0003, Reported' });
    fireEvent.click(screen.getByRole('button', { name: 'Triage' }));
    const dialog = screen.getByRole('dialog', { name: 'Triage LOSS-0003' });
    fireEvent.click(within(dialog).getByLabelText(/Suspected theft or fraud/));
    fireEvent.change(within(dialog).getByLabelText(/Police reference/), { target: { value: ' CA-PD-2026-118 ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Triage' }));
    expect(await screen.findByRole('heading', { name: 'LOSS-0003, Searching' })).toBeTruthy();
    expect(useToast.getState().message).toBe('Saved.');
    expect(screen.getByText(/channel key is exposed/)).toBeTruthy();
  });

  it('confirms a SEARCHING case from a dialog naming the device', async () => {
    let current = theCase({ state: 'SEARCHING', custody: 'RENTER', version: 1 });
    serve(
      () => current,
      (endpoint, options) => {
        expect(endpoint).toBe('/loss-cases/lc-1/confirm');
        expect(bodyOf(options)).toEqual({ expectedVersion: 1 });
        current = theCase({ state: 'CONFIRMED', custody: 'RENTER', chargeVnd: 1800000, version: 2 });
        return current;
      },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'LOSS-0003, Searching' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm loss' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm TL-0042 lost?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm loss' }));
    expect(await screen.findByRole('heading', { name: 'LOSS-0003, Confirmed lost' })).toBeTruthy();
  });

  it('hides Settle from Staff and from the Admin who triaged the case (BR-39)', async () => {
    serve(() => theCase({ state: 'CONFIRMED', custody: 'RENTER', triagedById: 'admin-1', chargeVnd: 1800000 }));
    viewer = { id: 'admin-1', roles: ['ADMIN'] };
    renderPage();
    await screen.findByRole('heading', { name: 'LOSS-0003, Confirmed lost' });
    expect(screen.queryByRole('button', { name: 'Settle' })).toBeNull();
    cleanup();
    viewer = { id: 'staff-1', roles: ['STAFF'] };
    renderPage();
    await screen.findByRole('heading', { name: 'LOSS-0003, Confirmed lost' });
    expect(screen.queryByRole('button', { name: 'Settle' })).toBeNull();
  });

  it('lets another Admin settle a reduction, refusing a charge not below the confirmed one', async () => {
    viewer = { id: 'admin-2', roles: ['ADMIN'] };
    let current = theCase({ state: 'CONFIRMED', custody: 'RENTER', triagedById: 'admin-1', chargeVnd: 1800000, version: 2 });
    serve(
      () => current,
      (endpoint, options) => {
        expect(endpoint).toBe('/loss-cases/lc-1/decision');
        expect(bodyOf(options)).toEqual({
          decision: 'REDUCED',
          chargeVnd: 900000,
          reason: 'Police report filed',
          expectedVersion: 2,
        });
        current = theCase({ state: 'SETTLED', custody: 'RENTER', decision: 'REDUCED', chargeVnd: 900000, version: 3 });
        return current;
      },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'LOSS-0003, Confirmed lost' });
    fireEvent.click(screen.getByRole('button', { name: 'Settle' }));
    const dialog = screen.getByRole('dialog', { name: 'Settle LOSS-0003' });
    expect(within(dialog).queryByLabelText('Written off')).toBeNull();
    fireEvent.click(within(dialog).getByLabelText('Reduced'));
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Police report filed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Settle' }));
    expect(await within(dialog).findByText(/A reduced charge is a whole amount below/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Charge \(VND\)/), { target: { value: '900000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Settle' }));
    expect(await screen.findByRole('heading', { name: 'LOSS-0003, Settled' })).toBeTruthy();
  });

  it('offers only Written off for TrekLink custody (AC-05)', async () => {
    viewer = { id: 'admin-2', roles: ['ADMIN'] };
    serve(() => theCase({ state: 'CONFIRMED', custody: 'TREKLINK', triagedById: 'staff-1', organization: null }));
    renderPage();
    await screen.findByRole('heading', { name: 'LOSS-0003, Confirmed lost' });
    fireEvent.click(screen.getByRole('button', { name: 'Settle' }));
    const dialog = screen.getByRole('dialog', { name: 'Settle LOSS-0003' });
    expect(within(dialog).getByLabelText('Written off')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Charged')).toBeNull();
  });

  it('records a recovery with its note, and shows MSG36 with Reload on STALE_VERSION', async () => {
    serve(
      () => theCase({ state: 'SEARCHING', version: 1 }),
      () => {
        throw new ApiError(409, 'STALE_VERSION', 'This was changed by someone else. Reload and try again.');
      },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'LOSS-0003, Searching' });
    fireEvent.click(screen.getByRole('button', { name: 'Record recovery' }));
    const dialog = screen.getByRole('dialog', { name: 'Record TL-0042 as recovered?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record recovery' }));
    expect(await within(dialog).findByText('Note is required.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: 'Handed in' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record recovery' }));
    expect(await within(dialog).findByText('Someone else changed this. Reload to see the latest.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows MSG26 for a case the viewer may not read', async () => {
    api.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Loss case not found.'));
    renderPage();
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
  });
});
