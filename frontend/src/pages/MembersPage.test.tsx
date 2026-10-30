// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { MembersPage } from './MembersPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      organization: { id: 'org-1', code: 'ORG-0001', legalName: 'TrekLink Demo Tours', status: 'ACTIVE', memberRole: 'MANAGER' },
    },
  }),
}));

const member = (overrides: Record<string, unknown> = {}) => ({
  id: 'm-1',
  userId: 'user-1',
  email: 'manager@acme-trek.vn',
  fullName: 'Nguyen Van A',
  role: 'MANAGER',
  invitationPending: false,
  deactivatedAt: null,
  ...overrides,
});

const operator = member({ id: 'm-2', userId: 'user-2', email: 'operator@acme-trek.vn', fullName: 'Pham Van D', role: 'OPERATOR' });
const pending = member({ id: 'm-3', userId: 'user-3', email: 'f.le@acme-trek.vn', fullName: 'Le Thi F', role: 'OPERATOR', invitationPending: true });

const LIST = '/organizations/org-1/members';

// Answers the list with `list` and every other call with `respond`.
const serve = (list: (endpoint: string) => unknown, respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) =>
    endpoint.startsWith(LIST) && !options?.method
      ? Promise.resolve(list(endpoint))
      : Promise.resolve().then(() => respond(endpoint, options)),
  );

// The table; the phone cards repeat each row's buttons.
const inTable = () => within(screen.getByRole('table', { name: 'Members' }));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('MembersPage (screen 3.3)', () => {
  it('lists the members with role, status and "(you)", and counts them', async () => {
    serve(() => [member(), operator, pending]);
    renderPage();

    const table = await screen.findByRole('table', { name: 'Members' });
    expect(within(table).getByText('Nguyen Van A')).toBeTruthy();
    expect(within(table).getByText('(you)')).toBeTruthy();
    expect(within(table).getByText('operator@acme-trek.vn')).toBeTruthy();
    expect(within(table).getByText('Invitation pending')).toBeTruthy();
    expect(within(table).getAllByText('Active')).toHaveLength(2);
    // Role badges read the ROLE_OPTIONS labels, not the enum values.
    expect(within(table).getAllByText('Manager')).toHaveLength(1);
    expect(within(table).getAllByText('Operator')).toHaveLength(2);
    expect(within(table).queryByText('OPERATOR')).toBeNull();
    expect(screen.getByText('3 members')).toBeTruthy();
    // Only the pending invitation can be resent.
    expect(within(table).getAllByRole('button', { name: /^Resend invitation to / })).toHaveLength(1);
    expect(api).toHaveBeenCalledWith(LIST);
  });

  it('asks for deactivated members when "Show deactivated" is on', async () => {
    serve((endpoint) =>
      endpoint.includes('includeDeactivated=true')
        ? [member(), member({ id: 'm-9', userId: 'user-9', fullName: 'Tran Van G', deactivatedAt: '2026-10-20T03:15:00.000Z' })]
        : [member()],
    );
    renderPage();
    await screen.findByText('1 member');
    fireEvent.click(screen.getByLabelText('Show deactivated'));
    await screen.findByText('2 members');
    expect(inTable().getByText(/^Deactivated /)).toBeTruthy();
    expect(api).toHaveBeenCalledWith(`${LIST}?includeDeactivated=true`);
    // A deactivated member has no actions.
    expect(inTable().queryByRole('button', { name: 'Deactivate Tran Van G' })).toBeNull();
  });

  it('invites a member as Operator by default and shows them pending after the refetch', async () => {
    let items: object[] = [member()];
    serve(
      () => items,
      (endpoint, options) => {
        expect(endpoint).toBe(LIST);
        expect(options).toEqual({
          method: 'POST',
          body: JSON.stringify({ email: 'new@acme-trek.vn', fullName: 'Le Thi F', role: 'OPERATOR' }),
        });
        items = [member(), { ...pending, email: 'new@acme-trek.vn' }];
        return items[1];
      },
    );
    renderPage();
    await screen.findByText('1 member');
    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: ' New@Acme-Trek.vn ' } });
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Le Thi F' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText('2 members')).toBeTruthy();
    expect(inTable().getByText('Invitation pending')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useToast.getState().message).toBe('Invitation sent');
  });

  it('requires email and full name before calling the server', async () => {
    serve(() => [member()]);
    renderPage();
    await screen.findByText('1 member');
    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Email is required.')).toBeTruthy();
    expect(screen.getByText('Full name is required.')).toBeTruthy();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('shows CONFLICT_UNIQUE under Email and keeps the form', async () => {
    serve(
      () => [member()],
      () => {
        throw new ApiError(409, 'CONFLICT_UNIQUE', 'operator@acme-trek.vn is already registered.');
      },
    );
    renderPage();
    await screen.findByText('1 member');
    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'operator@acme-trek.vn' } });
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Pham Van D' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText('operator@acme-trek.vn is already registered.')).toBeTruthy();
    expect((screen.getByLabelText(/^Full name/) as HTMLInputElement).value).toBe('Pham Van D');
  });

  it('deactivates a member with a reason and refreshes the list', async () => {
    let items: object[] = [member(), operator];
    serve(
      () => items,
      (endpoint, options) => {
        expect(endpoint).toBe(`${LIST}/m-2/deactivate`);
        expect(options).toEqual({ method: 'POST', body: JSON.stringify({ reason: 'Left the company' }) });
        items = [member()];
        return { ...operator, deactivatedAt: '2026-10-30T03:00:00.000Z' };
      },
    );
    renderPage();
    await screen.findByText('2 members');
    fireEvent.click(inTable().getByRole('button', { name: 'Deactivate Pham Van D' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Pham Van D?' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Left the company' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByText('1 member')).toBeTruthy();
    expect(useToast.getState().message).toBe('Member deactivated');
  });

  it('keeps the dialog open with the server message for the last Manager', async () => {
    serve(
      () => [member(), operator],
      () => {
        throw new ApiError(409, 'LAST_MANAGER', 'The organization must keep at least one Manager.');
      },
    );
    renderPage();
    await screen.findByText('2 members');
    fireEvent.click(inTable().getByRole('button', { name: 'Deactivate Nguyen Van A' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByText('The organization must keep at least one Manager.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Deactivate Nguyen Van A?' })).toBeTruthy();
  });

  it('changes a role, and shows LAST_MANAGER on a refused demotion', async () => {
    serve(
      () => [member(), operator],
      (endpoint, options) => {
        if (endpoint === `${LIST}/m-1`) throw new ApiError(409, 'LAST_MANAGER', 'The organization must keep at least one Manager.');
        expect(endpoint).toBe(`${LIST}/m-2`);
        expect(options).toEqual({ method: 'PATCH', body: JSON.stringify({ role: 'MANAGER' }) });
        return { ...operator, role: 'MANAGER' };
      },
    );
    renderPage();
    await screen.findByText('2 members');

    fireEvent.click(inTable().getByRole('button', { name: 'Change role of Pham Van D' }));
    fireEvent.click(screen.getByLabelText(/^Manager/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(inTable().getByRole('button', { name: 'Change role of Nguyen Van A' }));
    fireEvent.click(screen.getByLabelText(/^Operator/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The organization must keep at least one Manager.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('resends a pending invitation through the set-password code of auth api-design 05', async () => {
    serve(
      () => [member(), pending],
      (endpoint, options) => {
        expect(endpoint).toBe('/auth/password/forgot');
        expect(options).toEqual({ method: 'POST', body: JSON.stringify({ email: 'f.le@acme-trek.vn' }) });
        return null;
      },
    );
    renderPage();
    await screen.findByText('2 members');
    fireEvent.click(inTable().getByRole('button', { name: 'Resend invitation to Le Thi F' }));
    await waitFor(() => expect(useToast.getState().message).toBe('If an invitation is due, a new code was sent to f.le@acme-trek.vn.'));
  });

  it('shows NOT_FOUND as the server message and refetches', async () => {
    serve(
      () => [member(), operator],
      () => {
        throw new ApiError(404, 'NOT_FOUND', 'Member not found.');
      },
    );
    renderPage();
    await screen.findByText('2 members');
    const before = api.mock.calls.length;
    fireEvent.click(inTable().getByRole('button', { name: 'Deactivate Pham Van D' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Member not found.')).toBeTruthy();
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(before + 1));
  });

  it('keeps the phone card actions behind an Actions button', async () => {
    serve(() => [member(), operator]);
    renderPage();
    await screen.findByText('2 members');
    const toggle = screen.getByRole('button', { name: 'Actions for Pham Van D' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Only the table row carries the buttons until the card menu opens.
    expect(screen.getAllByRole('button', { name: 'Deactivate Pham Van D' })).toHaveLength(1);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Deactivate Pham Van D' })).toHaveLength(2);
  });

  it('shows the list error with a retry', async () => {
    api.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'Database unavailable.'));
    renderPage();
    expect(await screen.findByText('Database unavailable.')).toBeTruthy();
    serve(() => [member()]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 member')).toBeTruthy();
  });
});
