// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { ApiKeysPage } from './ApiKeysPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({
    user: {
      organization: { id: 'org-1', code: 'ORG-0001', legalName: 'TrekLink Demo Tours', status: 'ACTIVE', memberRole: 'MANAGER' },
    },
  }),
}));

const key = (overrides: Record<string, unknown> = {}) => ({
  id: 'k-1',
  name: 'ERP integration',
  prefix: 'tlk_7Hc2',
  createdAt: '2026-10-20T03:15:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

const LIST = '/organizations/org-1/api-keys';

// Answers the list with `list` and every other call with `respond`.
const serve = (list: () => unknown, respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) =>
    endpoint === LIST && !options?.method ? Promise.resolve(list()) : Promise.resolve().then(() => respond(endpoint, options)),
  );

// Create is disabled until the list (and its limit) is known.
const openCreate = async () => {
  await screen.findByText(/ of \d+ active keys/);
  fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ApiKeysPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('ApiKeysPage (screen 3.4)', () => {
  it('lists the keys with their prefix, last use and status, and counts them against the limit', async () => {
    serve(() => ({
      items: [key(), key({ id: 'k-2', name: 'Old BI', prefix: 'tlk_Zz9a', lastUsedAt: '2026-10-21T03:00:00.000Z', revokedAt: '2026-10-22T03:00:00.000Z' })],
      limit: 5,
    }));
    renderPage();

    const table = await screen.findByRole('table', { name: 'API keys' });
    expect(within(table).getByText('ERP integration')).toBeTruthy();
    expect(within(table).getByText('tlk_7Hc2')).toBeTruthy();
    expect(within(table).getByText('Never')).toBeTruthy();
    expect(within(table).getByText('Active')).toBeTruthy();
    expect(within(table).getByText(/^Revoked /)).toBeTruthy();
    expect(screen.getByText('1 of 5 active keys, 1 revoked')).toBeTruthy();
    // Only the active key can be revoked.
    expect(within(table).getAllByRole('button', { name: /^Revoke / })).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Create API key' }) as HTMLButtonElement).disabled).toBe(false);
    expect(api).toHaveBeenCalledWith(LIST);
  });

  it('shows the empty state when the organization has no key', async () => {
    serve(() => ({ items: [], limit: 5 }));
    renderPage();
    expect(await screen.findByText('No API keys yet')).toBeTruthy();
    expect(screen.getByText('0 of 5 active keys')).toBeTruthy();
  });

  it('disables Create at the limit and says why', async () => {
    serve(() => ({ items: [key(), key({ id: 'k-2', name: 'BI' })], limit: 2 }));
    renderPage();
    expect(await screen.findByText('2 of 2 active keys')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create API key' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Revoke an unused key before creating another/)).toBeTruthy();
  });

  it('shows the list error with a retry', async () => {
    api.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'Database unavailable.'));
    renderPage();
    expect(await screen.findByText('Database unavailable.')).toBeTruthy();
    serve(() => ({ items: [], limit: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No API keys yet')).toBeTruthy();
  });

  it('creates a key, shows the secret once with a copy button, and forgets it on Done', async () => {
    let items = [] as object[];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    serve(
      () => ({ items, limit: 5 }),
      (endpoint, options) => {
        expect(endpoint).toBe(LIST);
        expect(options).toEqual({ method: 'POST', body: JSON.stringify({ name: 'ERP integration' }) });
        items = [key()];
        return { ...key(), key: 'tlk_7Hc2Qm-full-secret' };
      },
    );
    renderPage();
    await openCreate();

    const form = screen.getByRole('dialog', { name: 'Create API key' });
    const name = within(form).getByLabelText(/^Name/);
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: '  ERP integration ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create key' }));

    const shown = await screen.findByRole('dialog', { name: 'API key ERP integration created' });
    expect(within(shown).getByLabelText('New API key').textContent).toBe('tlk_7Hc2Qm-full-secret');
    expect(within(shown).getByText('Copy it now; it will not be shown again.')).toBeTruthy();
    const copy = within(shown).getByRole('button', { name: 'Copy' });
    expect(document.activeElement).toBe(copy);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('tlk_7Hc2Qm-full-secret'));
    expect(await within(shown).findByRole('button', { name: 'Copied' })).toBeTruthy();

    // The list refetched and shows only the prefix.
    expect(await screen.findByRole('table', { name: 'API keys' })).toBeTruthy();
    fireEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('tlk_7Hc2Qm-full-secret')).toBeNull();
    expect(screen.getByText('1 of 5 active keys')).toBeTruthy();
  });

  it('asks the user to copy by hand when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    serve(() => ({ items: [], limit: 5 }), () => ({ ...key(), key: 'tlk_secret' }));
    renderPage();
    await openCreate();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'ERP' } });
    fireEvent.submit(screen.getByLabelText(/^Name/).closest('form')!);
    const shown = await screen.findByRole('dialog', { name: /created$/ });
    fireEvent.click(within(shown).getByRole('button', { name: 'Copy' }));
    expect(await within(shown).findByText(/browser blocked the clipboard/)).toBeTruthy();
  });

  it('refuses a blank name without calling the server (MSG02)', async () => {
    serve(() => ({ items: [], limit: 5 }));
    renderPage();
    await openCreate();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(screen.getByLabelText(/^Name/).getAttribute('aria-invalid')).toBe('true');
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open with the server message on KEY_LIMIT and on a server validation error', async () => {
    let answer: ApiError = new ApiError(409, 'KEY_LIMIT', 'Revoke an unused key before creating another.');
    serve(
      () => ({ items: [], limit: 5 }),
      () => {
        throw answer;
      },
    );
    renderPage();
    await openCreate();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'ERP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = screen.getByRole('dialog', { name: 'Create API key' });
    expect(await within(dialog).findByText('Revoke an unused key before creating another.')).toBeTruthy();
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('ERP');

    answer = new ApiError(400, 'VALIDATION_FAILED', 'name is required.');
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await within(dialog).findByText('name is required.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('revokes a key after a confirmation that names it, then toasts and moves focus to the heading', async () => {
    let items = [key()];
    serve(
      () => ({ items, limit: 5 }),
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/api-keys/k-1/revoke');
        expect(options).toEqual({ method: 'POST' });
        items = [key({ revokedAt: '2026-10-30T03:00:00.000Z' })];
        return items[0];
      },
    );
    renderPage();
    const table = await screen.findByRole('table', { name: 'API keys' });
    fireEvent.click(within(table).getByRole('button', { name: 'Revoke ERP integration' }));

    const confirm = screen.getByRole('dialog', { name: 'Revoke API key ERP integration?' });
    expect(within(confirm).getByText(/tlk_7Hc2 stops working from the next request/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke key' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useToast.getState().message).toBe('API key revoked');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'API keys' }));
    expect(await screen.findByText('0 of 5 active keys, 1 revoked')).toBeTruthy();
  });

  it('keeps the confirmation open with the server message when the key is gone, and refetches', async () => {
    serve(
      () => ({ items: [key()], limit: 5 }),
      () => {
        throw new ApiError(404, 'NOT_FOUND', 'API key not found.');
      },
    );
    renderPage();
    const table = await screen.findByRole('table', { name: 'API keys' });
    fireEvent.click(within(table).getByRole('button', { name: 'Revoke ERP integration' }));
    const confirm = screen.getByRole('dialog', { name: 'Revoke API key ERP integration?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke key' }));
    expect(await within(confirm).findByText('API key not found.')).toBeTruthy();
    await waitFor(() => expect(api.mock.calls.filter(([endpoint, options]) => endpoint === LIST && !options)).toHaveLength(2));

    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
