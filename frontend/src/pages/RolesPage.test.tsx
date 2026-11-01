// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { RolesPage } from './RolesPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: 'a-1', roles: ['ADMIN'] } }),
}));

const permission = (key: string, overrides: Record<string, unknown> = {}) => {
  const [subject, action, scope] = key.split('.');
  return {
    key,
    action,
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    scope: scope === 'own' ? 'own' : 'any',
    accountType: 'ORGANIZATION',
    description: `Can ${action} ${subject}`,
    protected: false,
    ...overrides,
  };
};

const CATALOG = [
  permission('liveMap.read.own'),
  permission('incident.read.own'),
  permission('incident.respond.own'),
  permission('role.manage', { accountType: 'TREKLINK', scope: 'any', protected: true }),
  permission('account.manage', { accountType: 'TREKLINK', scope: 'any' }),
];

const ROLES = [
  {
    id: 'r-admin',
    key: 'ADMIN',
    accountType: 'TREKLINK',
    isSystem: true,
    permissionKeys: ['role.manage', 'account.manage'],
  },
  { id: 'r-staff', key: 'STAFF', accountType: 'TREKLINK', isSystem: true, permissionKeys: [] },
  {
    id: 'r-op',
    key: 'ORG_OPERATOR',
    accountType: 'ORGANIZATION',
    isSystem: true,
    permissionKeys: ['liveMap.read.own'],
  },
];

const serve = (
  respond: (endpoint: string, options?: RequestInit) => unknown = () => ({
    id: 'r-op',
    key: 'ORG_OPERATOR',
    permissionCount: 1,
  }),
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (!options?.method) return Promise.resolve(endpoint === '/roles' ? ROLES : CATALOG);
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <RolesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const writes = () => api.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method);
// The role list of a wide screen; the phone select repeats the keys.
const list = () => within(screen.getByRole('listbox', { name: 'Roles' }));
const box = (key: string) =>
  screen.getByRole('checkbox', {
    name: new RegExp(`^${key.replace('.', '\\.')}`),
  }) as HTMLInputElement;

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('RolesPage (screen 7.2)', () => {
  it('lists the roles with their account type and permission count, and loads each read once', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    expect(list().getByText(/TrekLink, 2 permissions, System role/)).toBeTruthy();
    expect(list().getByText(/TrekLink, 0 permissions/)).toBeTruthy();
    expect(list().getByText(/Organization, 1 permission, System role/)).toBeTruthy();
    expect(api.mock.calls.filter((call) => call[0] === '/roles')).toHaveLength(1);
    expect(api.mock.calls.filter((call) => call[0] === '/permissions')).toHaveLength(1);
  });

  it('shows the checkboxes of the selected role from the catalog of its account type only', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    expect(box('role.manage').checked).toBe(true);
    expect(box('account.manage').checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: /^liveMap\.read\.own/ })).toBeNull();
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    expect(box('liveMap.read.own').checked).toBe(true);
    expect(box('incident.read.own').checked).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /^role\.manage/ })).toBeNull();
    expect(screen.getByText('Own organization only. Can read liveMap')).toBeTruthy();
  });

  it('locks a protected permission on ADMIN with its reason and notes the inherited set', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    expect(box('role.manage').disabled).toBe(true);
    expect(screen.getByText(/Required for Admin\./)).toBeTruthy();
    expect(box('account.manage').disabled).toBe(false);
    expect(screen.getByText(/ADMIN also holds every permission of STAFF/)).toBeTruthy();
  });

  it('says a role holds no permissions yet keeps the list editable', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('STAFF'));
    expect(screen.getByText('This role holds no permissions.')).toBeTruthy();
    expect(box('account.manage').disabled).toBe(false);
  });

  it('keeps Save disabled until the draft differs, and Discard puts the saved set back', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    const save = screen.getByRole('button', { name: 'Save permissions' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(box('incident.read.own'));
    expect(save.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(box('incident.read.own').checked).toBe(false);
    expect(save.disabled).toBe(true);
  });

  it('confirms with the diff, then sends the full list and toasts', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    fireEvent.click(box('liveMap.read.own'));
    fireEvent.click(box('incident.read.own'));
    fireEvent.click(box('incident.respond.own'));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    expect(await screen.findByText('Change ORG_OPERATOR: remove 1, add 2?')).toBeTruthy();
    expect(screen.getByText('Holders are affected on their next request.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Permissions updated'));
    const [endpoint, options] = writes()[0] as [string, RequestInit];
    expect(endpoint).toBe('/roles/r-op/permissions');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(String(options.body))).toEqual({
      permissionKeys: ['incident.read.own', 'incident.respond.own'],
    });
  });

  it('refreshes the signed-in Admin when the edited role is one they hold', async () => {
    serve(() => ({ id: 'r-admin', key: 'ADMIN', permissionCount: 1 }));
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(box('account.manage'));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save permissions' }),
    );
    await waitFor(() => expect(useToast.getState().message).toBe('Permissions updated'));
    await waitFor(() => expect(api.mock.calls.some((call) => call[0] === '/roles')).toBe(true));
  });

  it('asks before another role replaces a draft, and keeps the draft on Keep editing', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    fireEvent.click(box('incident.read.own'));
    fireEvent.click(list().getByText('STAFF'));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(box('incident.read.own').checked).toBe(true);
    fireEvent.click(list().getByText('STAFF'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByText('This role holds no permissions.')).toBeTruthy();
  });

  it('warns the browser before the tab closes while a draft is open', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.click(box('incident.read.own'));
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('moves between roles with the arrow keys and gives only the selected one a tab stop', async () => {
    serve();
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    const options = list().getAllByRole('option');
    expect(options.map((option) => option.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1], { key: 'End' });
    expect(document.activeElement).toBe(options[2]);
  });

  it('shows the server message for ADMIN_LOCKOUT in a dialog', async () => {
    serve(() => {
      throw new ApiError(409, 'ADMIN_LOCKOUT', 'Admins must keep the right to manage roles.');
    });
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(box('account.manage'));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save permissions' }),
    );
    expect(await screen.findByText('Admins must keep the right to manage roles.')).toBeTruthy();
    expect(screen.getByText('Admins must keep role management')).toBeTruthy();
  });

  it('keeps the draft, marks the key and reloads for UNKNOWN_PERMISSION', async () => {
    serve(() => {
      throw new ApiError(400, 'UNKNOWN_PERMISSION', 'Unknown permission: incident.read.own.');
    });
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    fireEvent.click(box('incident.read.own'));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save permissions' }),
    );
    expect(await screen.findByText('Unknown permission: incident.read.own.')).toBeTruthy();
    expect(box('incident.read.own').getAttribute('aria-invalid')).toBe('true');
    expect(box('incident.read.own').checked).toBe(true);
    await waitFor(() =>
      expect(api.mock.calls.filter((call) => call[0] === '/roles').length).toBeGreaterThan(1),
    );
  });

  it('shows the scope mismatch message in a banner', async () => {
    serve(() => {
      throw new ApiError(
        400,
        'PERMISSION_SCOPE_MISMATCH',
        'organization.decide cannot be granted to an organization role.',
      );
    });
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    fireEvent.click(box('incident.read.own'));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save permissions' }),
    );
    expect(
      await screen.findByText('organization.decide cannot be granted to an organization role.'),
    ).toBeTruthy();
  });

  it('toasts "Role not found." and reloads for a 404', async () => {
    serve(() => {
      throw new ApiError(404, 'NOT_FOUND', 'Role not found.');
    });
    renderPage();
    await screen.findByRole('listbox', { name: 'Roles' });
    fireEvent.click(list().getByText('ORG_OPERATOR'));
    fireEvent.click(box('incident.read.own'));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save permissions' }),
    );
    await waitFor(() => expect(useToast.getState().message).toBe('Role not found.'));
    await waitFor(() =>
      expect(api.mock.calls.filter((call) => call[0] === '/roles').length).toBeGreaterThan(1),
    );
  });

  it('shows MSG26 alone for a 403', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this.');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
