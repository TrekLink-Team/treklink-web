// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { AccountsPage } from './AccountsPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

vi.mock('../app/providers/useAuth', () => ({ useAuth: () => ({ user: { id: 'a-1' } }) }));

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 'a-1',
  email: 'admin@treklink.vn',
  fullName: 'Nguyen Admin',
  phoneNumber: '0901234567',
  accountType: 'TREKLINK',
  roles: ['ADMIN'],
  isActive: true,
  lastLoginAt: '2026-10-20T03:15:00.000Z',
  createdAt: '2026-10-01T03:15:00.000Z',
  ...overrides,
});

const staff = account({
  id: 'a-2',
  email: 'staff1@treklink.vn',
  fullName: 'Tran Thi B',
  roles: ['STAFF'],
});
const invited = account({
  id: 'a-3',
  email: 'new@treklink.vn',
  fullName: 'Le Van C',
  roles: ['STAFF'],
  phoneNumber: null,
  lastLoginAt: null,
});
const off = account({
  id: 'a-4',
  email: 'old@treklink.vn',
  fullName: 'Pham Van D',
  roles: ['STAFF'],
  isActive: false,
});

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: 1,
});

// Answers the reads with `list` (and the active-accounts read with the active ones) and writes with `respond`.
const serve = (
  items: ReturnType<typeof account>[],
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (!options?.method) {
      const activeOnly = endpoint.includes('isActive=true') && endpoint.includes('pageSize=100');
      return Promise.resolve(page(activeOnly ? items.filter((item) => item.isActive) : items));
    }
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const inTable = () => within(screen.getByRole('table', { name: 'Accounts' }));

// Shows the URL query the page keeps (screen 7.1 keeps its filters and page there).
const QueryProbe: React.FC = () => <output aria-label="Query">{useLocation().search}</output>;

const renderPage = (entry = '/t/admin/accounts') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <AccountsPage />
        <QueryProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const query = () => screen.getByLabelText('Query').textContent;

// A server that filters and pages like auth api-design 09, for lists longer than one page.
const servePaged = (items: ReturnType<typeof account>[]) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (options?.method) return Promise.resolve(undefined);
    const params = new URLSearchParams(endpoint.split('?')[1] ?? '');
    const isActive = params.get('isActive');
    const needle = params.get('q')?.toLowerCase();
    const matching = items.filter(
      (item) =>
        (isActive === null || String(item.isActive) === isActive) &&
        (!needle || item.fullName.toLowerCase().includes(needle)),
    );
    const pageNumber = Number(params.get('pageNumber') ?? 1);
    const pageSize = Number(params.get('pageSize') ?? 20);
    return Promise.resolve({
      items: matching.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      pageNumber,
      pageSize,
      totalCount: matching.length,
      totalPages: Math.max(1, Math.ceil(matching.length / pageSize)),
    });
  });
const reads = () =>
  api.mock.calls
    .filter((call) => !(call[1] as RequestInit | undefined)?.method)
    .map((call) => String(call[0]));

const writes = () => api.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method);

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('AccountsPage (screen 7.1)', () => {
  it('lists name, email, phone, role, status and last sign-in, with Never and the pending hint', async () => {
    serve([account(), staff, invited, off]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    expect(inTable().getByText('(you)')).toBeTruthy();
    expect(inTable().getByText('staff1@treklink.vn')).toBeTruthy();
    expect(inTable().getAllByText('0901234567').length).toBeGreaterThan(0);
    expect(inTable().getByText('Never')).toBeTruthy();
    expect(inTable().getByText('Invitation pending')).toBeTruthy();
    expect(inTable().getAllByText('ACTIVE')).toHaveLength(3);
    expect(inTable().getByText('DEACTIVATED')).toBeTruthy();
    expect(inTable().getByText('ADMIN')).toBeTruthy();
  });

  it('names the zone once in the sign-in hover', async () => {
    serve([account()]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    expect(inTable().getAllByTitle('20 Oct 2026, 03:15:00 UTC').length).toBeGreaterThan(0);
  });

  it('sends the search and the status filter to the list', async () => {
    serve([account(), staff]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'tran' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'false' } });
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          (call) =>
            String(call[0]).includes('q=tran') && String(call[0]).includes('isActive=false'),
        ),
      ).toBe(true),
    );
  });

  it('shows the empty message with Clear filters when a filter finds nothing', async () => {
    serve([]);
    renderPage();
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'false' } });
    expect((await screen.findAllByText('No results match your filters.')).length).toBeGreaterThan(
      0,
    );
  });

  it('disables Deactivate on the last active Admin and says why under the name', async () => {
    serve([account(), staff, off]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    await waitFor(() => expect(inTable().getByText('Last active Admin')).toBeTruthy());
    // Under the name, in the account cell, not in the actions column.
    expect(inTable().getByText('Last active Admin').closest('#account-name-a-1')).toBeTruthy();
    expect(
      (inTable().getByRole('button', { name: 'Deactivate Nguyen Admin' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (inTable().getByRole('button', { name: 'Deactivate Tran Thi B' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('keeps Deactivate enabled when a second active Admin exists', async () => {
    serve([
      account(),
      account({ id: 'a-9', fullName: 'Second Admin', email: 'two@treklink.vn' }),
      staff,
    ]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(1));
    expect(inTable().queryByText('Last active Admin')).toBeNull();
  });

  it('creates an account with a lower-cased email and toasts the server message', async () => {
    serve([account()], () => account({ id: 'a-5' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New account' }));
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: ' New@TrekLink.vn ' } });
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText(/Role/), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(useToast.getState().message).toBe('Account created, invitation sent'),
    );
    const [endpoint, options] = writes()[0] as [string, RequestInit];
    expect(endpoint).toBe('/accounts');
    expect(JSON.parse(String(options.body))).toEqual({
      email: 'new@treklink.vn',
      fullName: 'New Person',
      role: 'ADMIN',
    });
  });

  it('shows MSG10 under the email field for a duplicate and keeps the input', async () => {
    serve([account()], () => {
      throw new ApiError(409, 'CONFLICT_UNIQUE', 'dup@treklink.vn is already registered.');
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New account' }));
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'dup@treklink.vn' } });
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('dup@treklink.vn is already registered.')).toBeTruthy();
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('dup@treklink.vn');
  });

  it('requires an email and a name before sending a create', async () => {
    serve([account()]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Email is required.')).toBeTruthy();
    expect(screen.getByText('Full name is required.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('disables the role control on the signed-in Admin own row', async () => {
    serve([account(), staff]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Edit Nguyen Admin' }));
    expect((screen.getByLabelText('Role') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('You cannot change your own role.')).toBeTruthy();
  });

  it('asks before a role change, sends only what changed, and toasts', async () => {
    serve([account(), staff], () => staff);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Edit Tran Thi B' }));
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Change Tran Thi B from Staff to Admin?')).toBeTruthy();
    expect(screen.getByText('It applies on their next request.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Account updated'));
    const [endpoint, options] = writes()[0] as [string, RequestInit];
    expect(endpoint).toBe('/accounts/a-2');
    expect(JSON.parse(String(options.body))).toEqual({ role: 'ADMIN' });
  });

  it('edits a name without asking about the role', async () => {
    serve([account(), staff], () => staff);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Edit Tran Thi B' }));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Tran Thi Bich' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Account updated'));
    expect(JSON.parse(String((writes()[0][1] as RequestInit).body))).toEqual({
      fullName: 'Tran Thi Bich',
    });
  });

  it('shows the server message when a self demotion gets through', async () => {
    serve(
      [account({ id: 'a-7', fullName: 'Other Admin', email: 'o@treklink.vn' }), account()],
      () => {
        throw new ApiError(409, 'SELF_DEMOTION', 'You cannot remove your own Admin role.');
      },
    );
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Edit Other Admin' }));
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'STAFF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change role' }));
    expect(await screen.findByText('You cannot remove your own Admin role.')).toBeTruthy();
  });

  it('requires a reason to deactivate, then sends it and toasts', async () => {
    serve([account(), staff], () => staff);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    await waitFor(() => expect(inTable().getByText('Last active Admin')).toBeTruthy());
    fireEvent.click(inTable().getByRole('button', { name: 'Deactivate Tran Thi B' }));
    expect(screen.getByText('Deactivate Tran Thi B?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Reason is required.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: ' Left the company ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Account deactivated'));
    const [endpoint, options] = writes()[0] as [string, RequestInit];
    expect(endpoint).toBe('/accounts/a-2/deactivate');
    expect(JSON.parse(String(options.body))).toEqual({ reason: 'Left the company' });
  });

  it('shows the server message when LAST_ADMIN gets through', async () => {
    serve([account(), staff], () => {
      throw new ApiError(409, 'LAST_ADMIN', 'At least one Admin must stay active.');
    });
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Deactivate Tran Thi B' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('At least one Admin must stay active.')).toBeTruthy();
  });

  it('reactivates a deactivated account after a confirmation', async () => {
    serve([account(), off], () => off);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    expect(inTable().queryByRole('button', { name: 'Edit Pham Van D' })).toBeNull();
    fireEvent.click(inTable().getByRole('button', { name: 'Reactivate Pham Van D' }));
    expect(screen.getByText('Reactivate Pham Van D?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Account reactivated'));
    expect(writes()[0][0]).toBe('/accounts/a-4/reactivate');
  });

  it('sends a reset code after naming the email, and shows a cooldown refusal', async () => {
    serve([account(), staff], () => null);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Send reset code to Tran Thi B' }));
    expect(screen.getByText('Send a reset code to staff1@treklink.vn?')).toBeTruthy();
    expect(screen.getByText('You will not see the password.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    await waitFor(() =>
      expect(useToast.getState().message).toBe('Reset code sent to the account email'),
    );
    expect(writes()[0][0]).toBe('/accounts/a-2/password-reset');
  });

  it('shows the cooldown message inside the reset dialog', async () => {
    serve([account(), staff], () => {
      throw new ApiError(
        429,
        'OTP_COOLDOWN',
        'Please wait a minute before requesting another code.',
      );
    });
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Send reset code to Tran Thi B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(
      await screen.findByText('Please wait a minute before requesting another code.'),
    ).toBeTruthy();
  });

  it('toasts "Account not found." and reloads when another Admin removed the row', async () => {
    serve([account(), staff], () => {
      throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    });
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Send reset code to Tran Thi B' }));
    const reads = api.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Account not found.'));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(reads + 1));
  });

  it('shows MSG26 alone for a 403', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this.');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps the last-Admin guard with the Active filter over more than 20 active accounts', async () => {
    // 45 active accounts, one Admin among them: the table reads 20 rows, the guard 100.
    const many = Array.from({ length: 44 }, (_, index) =>
      account({
        id: `s-${index}`,
        email: `staff${index}@treklink.vn`,
        fullName: `Staff ${index}`,
        roles: ['STAFF'],
      }),
    );
    servePaged([account(), ...many]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    await waitFor(() => expect(inTable().getByText('Last active Admin')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'true' } });
    await waitFor(() =>
      expect(reads()).toContain('/accounts?isActive=true&pageNumber=1&pageSize=20'),
    );
    await waitFor(() => expect(inTable().getAllByRole('row')).toHaveLength(21));
    expect(inTable().getByText('Last active Admin')).toBeTruthy();
    expect(
      (inTable().getByRole('button', { name: 'Deactivate Nguyen Admin' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('reads search, status and page from the URL', async () => {
    serve([staff]);
    renderPage('/t/admin/accounts?q=tran&isActive=true&page=2');
    await screen.findByRole('table', { name: 'Accounts' });
    expect(reads()).toContain('/accounts?q=tran&isActive=true&pageNumber=2&pageSize=20');
    expect((screen.getByLabelText('Search accounts') as HTMLInputElement).value).toBe('tran');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('true');
  });

  it('writes the search, status and page to the URL, a new filter starting on page 1', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      account({ id: `s-${index}`, fullName: `Staff ${index}`, roles: ['STAFF'] }),
    );
    servePaged([account(), ...many]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(query()).toBe('?page=2'));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'true' } });
    await waitFor(() => expect(query()).toBe('?isActive=true'));

    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'staff 1' } });
    await waitFor(() => expect(query()).toBe('?isActive=true&q=staff+1'));
  });

  it('clears the filters and the page with Clear filters', async () => {
    serve([]);
    renderPage('/t/admin/accounts?q=nobody&isActive=false&page=3');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Clear filters' }))[0]);
    await waitFor(() => expect(query()).toBe(''));
    await waitFor(() => expect(reads()).toContain('/accounts?pageNumber=1&pageSize=20'));
    expect((screen.getByLabelText('Search accounts') as HTMLInputElement).value).toBe('');
  });

  it('labels the reset button Send reset code and names the account to a screen reader', async () => {
    serve([account(), staff]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    const button = inTable().getByRole('button', { name: 'Send reset code to Tran Thi B' });
    expect(button.textContent).toBe('Send reset code');
  });

  it('says in the phone hint that a phone cannot be removed', async () => {
    serve([account(), staff]);
    renderPage();
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(inTable().getByRole('button', { name: 'Edit Tran Thi B' }));
    expect(
      screen.getByText(
        'A phone number can be changed but not removed: an empty field keeps the current one.',
      ),
    ).toBeTruthy();
  });

  it('clears the filters after a create and moves focus to the new row name cell', async () => {
    const created = account({
      id: 'a-5',
      email: 'new@treklink.vn',
      fullName: 'New Person',
      roles: ['STAFF'],
      lastLoginAt: null,
    });
    let list = [account(), staff];
    api.mockImplementation((endpoint: string, options?: RequestInit) => {
      if (options?.method) {
        list = [created, ...list];
        return Promise.resolve(created);
      }
      return Promise.resolve(page(endpoint.includes('q=') ? [] : list));
    });
    renderPage('/t/admin/accounts?q=zzz&page=2');
    fireEvent.click(await screen.findByRole('button', { name: 'New account' }));
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'new@treklink.vn' } });
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'New Person' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('account-name-a-5'));
    expect(query()).toBe('');
    expect(document.activeElement?.textContent).toContain('New Person');
  });
});
