// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { RosterPage } from './RosterPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

let memberRole: 'MANAGER' | 'OPERATOR' = 'MANAGER';
vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      organization: { id: 'org-1', code: 'ORG-0001', legalName: 'TrekLink Demo Tours', status: 'ACTIVE', memberRole },
    },
  }),
}));

// Times in the viewer's zone, so the tests hold in any TZ. "Now" is Wed 21 Oct 2026 10:00.
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
const NOW = new Date(2026, 9, 21, 10, 0);
const FROM = at(19, 0);
const TO = at(26, 0);
const ROSTER = `/organizations/org-1/roster?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;
const MEMBERS = '/organizations/org-1/members';

const pham = { memberId: 'm-2', fullName: 'Pham Van D' };
const le = { memberId: 'm-3', fullName: 'Le Thi F' };

const shift = (overrides: Record<string, unknown> = {}) => ({
  id: 's-1',
  startsAt: at(22, 0),
  endsAt: at(22, 12),
  primary: pham,
  backup: null,
  ...overrides,
});
const started = shift({ id: 's-2', startsAt: at(21, 6), endsAt: at(21, 18), backup: le });

const members = [
  { id: 'm-2', userId: 'u-2', email: 'operator@acme-trek.vn', fullName: 'Pham Van D', role: 'OPERATOR', invitationPending: false, deactivatedAt: null },
  { id: 'm-3', userId: 'u-3', email: 'f.le@acme-trek.vn', fullName: 'Le Thi F', role: 'OPERATOR', invitationPending: false, deactivatedAt: null },
  { id: 'm-4', userId: 'u-4', email: 'new@acme-trek.vn', fullName: 'Pending Person', role: 'OPERATOR', invitationPending: true, deactivatedAt: null },
];

// Answers the roster reads with `week`, the member list with `members`, and every change with `respond`.
const serve = (
  week: (endpoint: string) => unknown,
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (options?.method) return Promise.resolve().then(() => respond(endpoint, options));
    if (endpoint.startsWith(MEMBERS)) return Promise.resolve(members);
    return Promise.resolve(week(endpoint));
  });

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RosterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const saved = (value: object) => ({ shift: value, warnings: [] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  memberRole = 'MANAGER';
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RosterPage (screen 3.3)', () => {
  it('shows the week from Monday, its shifts, "backup: none" and the MSG22 warning', async () => {
    serve(() => ({ shifts: [shift()], warnings: [{ kind: 'NO_PRIMARY', from: at(22, 12), to: at(23, 0) }] }));
    renderPage();

    expect(await screen.findByRole('button', { name: /^Pham Van D, primary, Thu 22 Oct 00:00 to 12:00/ })).toBeTruthy();
    expect(screen.getByText('backup: none')).toBeTruthy();
    expect(screen.getByText(/^Nobody is primary on duty Thu 22 Oct 12:00 to Fri 23 Oct 00:00/)).toBeTruthy();
    expect(screen.getByText('Alerts in that window start with the backup.')).toBeTruthy();
    expect(screen.getByText(/^Mon 19 Oct to Sun 25 Oct 2026/)).toBeTruthy();
    expect(api).toHaveBeenCalledWith(ROSTER);
  });

  it('moves a week with Next', async () => {
    serve(() => ({ shifts: [], warnings: [] }));
    renderPage();
    await screen.findByText(/^Mon 19 Oct/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/^Mon 26 Oct to Sun 01 Nov 2026/)).toBeTruthy();
    expect(api).toHaveBeenCalledWith(
      `/organizations/org-1/roster?from=${encodeURIComponent(at(26, 0))}&to=${encodeURIComponent(new Date(2026, 10, 2).toISOString())}`,
    );
  });

  it('gives an Org Operator the week read only', async () => {
    memberRole = 'OPERATOR';
    serve(() => ({ shifts: [shift()], warnings: [] }));
    renderPage();
    expect(await screen.findByRole('group', { name: /^Pham Van D, primary/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add shift' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pham Van D/ })).toBeNull();
    expect(api).not.toHaveBeenCalledWith(MEMBERS);
  });

  it('adds a shift with active members only and sends UTC times', async () => {
    let shifts: object[] = [];
    serve(
      () => ({ shifts, warnings: [] }),
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/roster');
        expect(options).toEqual({
          method: 'POST',
          body: JSON.stringify({ startsAt: at(23, 0), endsAt: at(23, 12), primaryMemberId: 'm-2', backupMemberId: 'm-3' }),
        });
        shifts = [shift({ id: 's-9', startsAt: at(23, 0), endsAt: at(23, 12), backup: le })];
        return saved(shifts[0]);
      },
    );
    renderPage();
    await screen.findByText(/^Mon 19 Oct/);
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
    const dialog = screen.getByRole('dialog', { name: 'Add shift' });
    // A pending invitation cannot stand on the roster.
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'Pham Van D' })).toHaveLength(2));
    expect(within(dialog).queryByRole('option', { name: 'Pending Person' })).toBeNull();

    fireEvent.change(within(dialog).getByLabelText(/^Starts/), { target: { value: '2026-10-23T00:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^Ends/), { target: { value: '2026-10-23T12:00' } });
    fireEvent.change(within(dialog).getByLabelText('Primary'), { target: { value: 'm-2' } });
    fireEvent.change(within(dialog).getByLabelText('Backup'), { target: { value: 'm-3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save shift' }));

    expect(await screen.findByRole('button', { name: /^Pham Van D, primary, Fri 23 Oct/ })).toBeTruthy();
    expect(useToast.getState().message).toBe('Saved.');
  });

  it('blocks an end before the start and the same member twice', async () => {
    serve(() => ({ shifts: [], warnings: [] }));
    renderPage();
    await screen.findByText(/^Mon 19 Oct/);
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'Pham Van D' })).toHaveLength(2));
    fireEvent.change(within(dialog).getByLabelText(/^Starts/), { target: { value: '2026-10-23T12:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^Ends/), { target: { value: '2026-10-23T06:00' } });
    fireEvent.change(within(dialog).getByLabelText('Primary'), { target: { value: 'm-2' } });
    fireEvent.change(within(dialog).getByLabelText('Backup'), { target: { value: 'm-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save shift' }));

    expect(await screen.findByText('Choose an end after the start.')).toBeTruthy();
    expect(screen.getByText('Choose two different active members of your organization.')).toBeTruthy();
    expect(api.mock.calls.every(([, options]) => !(options as RequestInit | undefined)?.method)).toBe(true);
  });

  it('shows SHIFT_OVERLAP under Starts and keeps the form', async () => {
    serve(
      () => ({ shifts: [], warnings: [] }),
      () => {
        throw new ApiError(409, 'SHIFT_OVERLAP', 'This shift overlaps another one.');
      },
    );
    renderPage();
    await screen.findByText(/^Mon 19 Oct/);
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Starts/), { target: { value: '2026-10-22T06:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^Ends/), { target: { value: '2026-10-22T18:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save shift' }));

    const error = await within(dialog).findByText('This shift overlaps another one.');
    expect(error.id).toBe('shift-starts-error');
    expect((within(dialog).getByLabelText(/^Starts/) as HTMLInputElement).value).toBe('2026-10-22T06:00');
  });

  it('edits only the end of a started shift and cannot delete it', async () => {
    serve(
      () => ({ shifts: [started], warnings: [] }),
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/roster/s-2');
        expect(options).toEqual({ method: 'PATCH', body: JSON.stringify({ endsAt: at(21, 14) }) });
        return saved({ ...started, endsAt: at(21, 14) });
      },
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pham Van D, primary, Wed 21 Oct 06:00/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit shift' });
    expect((within(dialog).getByLabelText(/^Starts/) as HTMLInputElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText('Primary') as HTMLSelectElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText('Backup') as HTMLSelectElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText('A started shift is shortened by editing its end.')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/^Ends/), { target: { value: '2026-10-21T14:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
  });

  it('refuses an end before now on a started shift', async () => {
    serve(() => ({ shifts: [started], warnings: [] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pham Van D, primary, Wed 21 Oct 06:00/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Ends/), { target: { value: '2026-10-21T08:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save shift' }));
    expect(await within(dialog).findByText('endsAt must not be in the past.')).toBeTruthy();
  });

  it('shows SHIFT_STARTED from the server as an Alert and refetches', async () => {
    serve(
      () => ({ shifts: [shift()], warnings: [] }),
      () => {
        throw new ApiError(409, 'SHIFT_STARTED', 'Only the end of a started shift can change.');
      },
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pham Van D, primary, Thu 22 Oct/ }));
    const reads = api.mock.calls.length;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Only the end of a started shift can change.')).toBeTruthy();
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(reads + 1));
  });

  it('deletes a shift that has not started after naming its window', async () => {
    let shifts: object[] = [shift()];
    serve(
      () => ({ shifts, warnings: [] }),
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/roster/s-1');
        expect(options).toEqual({ method: 'DELETE' });
        shifts = [];
        return null;
      },
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pham Van D, primary, Thu 22 Oct/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete the shift Thu 22 Oct 00:00 to 12:00?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete shift' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Pham Van D, primary/ })).toBeNull());
    expect(useToast.getState().message).toBe('Shift deleted');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the roster error', async () => {
    api.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Database unavailable.'));
    renderPage();
    expect(await screen.findByText('Database unavailable.')).toBeTruthy();
  });
});
