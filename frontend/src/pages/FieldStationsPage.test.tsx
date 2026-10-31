// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { FieldStationsPage } from './FieldStationsPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

let role = 'ORG_MANAGER';
vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({
    user: {
      organization: { id: 'org-1', code: 'ORG-0007', legalName: 'Ta Nang Treks', status: 'ACTIVE' },
      roles: [role],
    },
  }),
}));

const LIST = '/organizations/org-1/field-stations';
const RELEASE = '/organizations/org-1/field-stations/release';

const station = (overrides: Record<string, unknown> = {}) => ({
  id: 'fs-1',
  name: 'Office laptop',
  mqttUsername: 'fs-org-0007-1',
  createdAt: '2026-10-20T03:15:00.000Z',
  revokedAt: null,
  lastSyncAt: null,
  queueDepth: null,
  oldestRetryCount: 0,
  version: '1.2.0',
  outdated: false,
  ...overrides,
});

const release = () => ({
  version: '1.2.0',
  publishedAt: '2026-10-20T03:15:00.000Z',
  files: [{ os: 'windows-x64', downloadUrl: '/downloads/field-station/1.2.0/win.exe', sha256: 'a'.repeat(64), sizeBytes: 48211456 }],
});

// Routes by exact endpoint; everything that is not the list or the release is a mutation handled by `respond`.
const serve = (
  list: () => unknown,
  releaseAnswer: () => unknown = release,
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint === LIST && !options?.method) return Promise.resolve(list());
    if (endpoint === RELEASE) return Promise.resolve().then(releaseAnswer);
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FieldStationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  role = 'ORG_MANAGER';
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('FieldStationsPage (screen 3.5)', () => {
  it('lists stations with version, queue and status, and shows the release card', async () => {
    serve(() => ({
      items: [
        station(),
        station({ id: 'fs-2', name: 'Trailhead', queueDepth: { p0: 0, p1: 0, p2: 3, p3: 12 }, revokedAt: '2026-10-25T00:00:00.000Z' }),
      ],
      limit: 5,
    }));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Field Stations' });
    expect(within(table).getByText('Office laptop')).toBeTruthy();
    expect(within(table).getAllByText('Never')).toHaveLength(2);
    expect(within(table).getByText('No data yet')).toBeTruthy();
    expect(within(table).getByText('0 / 0 / 3 / 12')).toBeTruthy();
    expect(within(table).getByText('Active')).toBeTruthy();
    expect(within(table).getByText(/^Revoked /)).toBeTruthy();
    expect(screen.getByText('1 of 5 active stations, 1 revoked')).toBeTruthy();
    // A revoked row has no Revoke action.
    expect(within(table).getAllByRole('button', { name: /^Revoke / })).toHaveLength(1);

    const release = await screen.findByRole('region', { name: 'Field Station software' });
    expect(within(release).getByText('1.2.0')).toBeTruthy();
    expect(within(release).getByText(/SHA-256 a{64}/)).toBeTruthy();
    expect(within(release).getByRole('link', { name: 'Download for Windows' })).toBeTruthy();
  });

  it('shows the empty state with Create Field Station as the next step', async () => {
    serve(() => ({ items: [], limit: 5 }));
    renderPage();
    expect(await screen.findByText('No Field Stations yet')).toBeTruthy();
    expect(screen.getByText(/Create a credential, then run the Field Station/)).toBeTruthy();
  });

  it('disables Create at the limit and flags an outdated station', async () => {
    serve(() => ({
      items: [station(), station({ id: 'fs-2', name: 'Old one', outdated: true })],
      limit: 2,
    }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Field Stations' });
    await screen.findByText('2 of 2 active stations');
    expect((screen.getByRole('button', { name: 'Create Field Station' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/1 of 2 active stations runs an older version/)).toBeTruthy();
    expect(within(table).getByText('Outdated')).toBeTruthy();
  });

  it('shows RELEASE_UNAVAILABLE as an empty release card while the station table stays usable', async () => {
    serve(
      () => ({ items: [station()], limit: 5 }),
      () => {
        throw new ApiError(503, 'RELEASE_UNAVAILABLE', 'The Field Station download is unavailable. Try again later.');
      },
    );
    renderPage();
    const card = await screen.findByRole('region', { name: 'Field Station software' });
    expect(await within(card).findByText('No download published yet')).toBeTruthy();
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(await screen.findByRole('table', { name: 'Field Stations' })).toBeTruthy();
  });

  it('keeps the error and Retry in the release card for any other failure', async () => {
    serve(
      () => ({ items: [station()], limit: 5 }),
      () => {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.');
      },
    );
    renderPage();
    const card = await screen.findByRole('region', { name: 'Field Station software' });
    expect(await within(card).findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(within(card).queryByText('No download published yet')).toBeNull();
  });

  it('creates a Field Station, shows the credential once, and forgets it on Done', async () => {
    let items: object[] = [];
    serve(
      () => ({ items, limit: 5 }),
      release,
      (endpoint, options) => {
        expect(endpoint).toBe(LIST);
        expect(options).toEqual({ method: 'POST', body: JSON.stringify({ name: 'Ta Nang basecamp laptop' }) });
        items = [station({ name: 'Ta Nang basecamp laptop' })];
        return { ...station({ name: 'Ta Nang basecamp laptop' }), mqttSecret: 'fs_s3cr3t', brokerUrl: 'mqtts://mqtt.treklink.vn:8883' };
      },
    );
    renderPage();
    await screen.findByText('No Field Stations yet');
    fireEvent.click(screen.getByRole('button', { name: 'Create Field Station' }));

    const form = screen.getByRole('dialog', { name: 'Create Field Station' });
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: 'Ta Nang basecamp laptop' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create' }));

    const shown = await screen.findByRole('dialog', { name: 'Credential for Ta Nang basecamp laptop' });
    expect(within(shown).getByText('mqtts://mqtt.treklink.vn:8883')).toBeTruthy();
    expect(within(shown).getByText('fs_s3cr3t')).toBeTruthy();

    fireEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('fs_s3cr3t')).toBeNull();
    expect(await screen.findByRole('table', { name: 'Field Stations' })).toBeTruthy();
  });

  it('refuses a blank name without calling the server (MSG02)', async () => {
    serve(() => ({ items: [], limit: 5 }));
    renderPage();
    await screen.findByText('No Field Stations yet');
    fireEvent.click(screen.getByRole('button', { name: 'Create Field Station' }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(api.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('keeps the create dialog open with the server message on STATION_LIMIT', async () => {
    serve(
      () => ({ items: [], limit: 5 }),
      release,
      () => {
        throw new ApiError(409, 'STATION_LIMIT', 'Revoke an unused Field Station before creating another.');
      },
    );
    renderPage();
    await screen.findByText('No Field Stations yet');
    fireEvent.click(screen.getByRole('button', { name: 'Create Field Station' }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Ta Nang' } });
    const dialog = screen.getByRole('dialog', { name: 'Create Field Station' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Revoke an unused Field Station before creating another.')).toBeTruthy();
  });

  it('revokes a station after a confirmation that names it, then toasts and moves focus to the heading', async () => {
    let items = [station()];
    serve(
      () => ({ items, limit: 5 }),
      release,
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/field-stations/fs-1/revoke');
        expect(options).toEqual({ method: 'POST', body: JSON.stringify({}) });
        items = [station({ revokedAt: '2026-10-30T03:00:00.000Z' })];
        return items[0];
      },
    );
    renderPage();
    const table = await screen.findByRole('table', { name: 'Field Stations' });
    fireEvent.click(within(table).getByRole('button', { name: 'Revoke Office laptop' }));

    const confirm = screen.getByRole('dialog', { name: 'Revoke Field Station Office laptop?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useToast.getState().message).toBe('Field Station credential revoked');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Field stations' }));
    expect(await screen.findByText('0 of 5 active stations, 1 revoked')).toBeTruthy();
  });

  it('hides Create and Revoke for an Org Operator', async () => {
    role = 'ORG_OPERATOR';
    serve(() => ({ items: [station()], limit: 5 }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Field Stations' });
    expect(screen.queryByRole('button', { name: 'Create Field Station' })).toBeNull();
    expect(within(table).queryByRole('button', { name: /^Revoke / })).toBeNull();
  });
});
