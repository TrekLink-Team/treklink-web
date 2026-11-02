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
    id: 'r-op',
    key: 'ORG_OPERATOR',
    accountType: 'ORGANIZATION',
    isSystem: true,
    permissionKeys: ['liveMap.read.own'],
  },
  { id: 'r-staff', key: 'STAFF', accountType: 'TREKLINK', isSystem: true, permissionKeys: [] },
  {
    id: 'r-admin',
    key: 'ADMIN',
    accountType: 'TREKLINK',
    isSystem: true,
    permissionKeys: ['role.manage', 'account.manage'],
  },
  {
    id: 'r-mgr',
    key: 'ORG_MANAGER',
    accountType: 'ORGANIZATION',
    isSystem: true,
    permissionKeys: [],
  },
];

const serve = (respond: (endpoint: string, options?: RequestInit) => unknown = () => ({})) =>
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
const reads = (endpoint: string) => api.mock.calls.filter((call) => call[0] === endpoint);
const cell = (key: string, role: string) =>
  screen.getByRole('checkbox', {
    name: new RegExp(`^${key.replace('.', '\\.')} for ${role}(,|$)`),
  }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
const confirm = async () =>
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save permissions' }),
  );
const loaded = () => screen.findByRole('table', { name: 'Permissions by role' });

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RolesPage (screen 7.2), the grid', () => {
  it('is one table with a column per role in the fixed order, and reads each list once', async () => {
    serve();
    renderPage();
    await loaded();
    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent ?? '');
    expect(headers[0]).toBe('Permission');
    expect(headers.slice(1).map((text) => text.split(/[A-Z][a-z]/)[0])).toEqual([
      'ADMIN',
      'STAFF',
      'ORG_MANAGER',
      'ORG_OPERATOR',
    ]);
    expect(headers[1]).toContain('2 permissions');
    expect(headers[4]).toContain('1 permission');
    expect(reads('/roles')).toHaveLength(1);
    expect(reads('/permissions')).toHaveLength(1);
  });

  it('groups the rows by subject and ticks the cells the role holds', async () => {
    serve();
    renderPage();
    await loaded();
    const groups = screen
      .getAllByRole('rowheader')
      .filter((node) => node.getAttribute('scope') === 'rowgroup');
    expect(groups.map((node) => node.textContent)).toEqual([
      'Account',
      'Incident',
      'LiveMap',
      'Role',
    ]);
    expect(cell('account.manage', 'ADMIN').checked).toBe(true);
    expect(cell('account.manage', 'STAFF').checked).toBe(false);
    expect(cell('liveMap.read.own', 'ORG_OPERATOR').checked).toBe(true);
    expect(cell('incident.read.own', 'ORG_OPERATOR').checked).toBe(false);
  });

  it('gives no box to a permission of the other account type', async () => {
    serve();
    renderPage();
    await loaded();
    expect(screen.queryByRole('checkbox', { name: /^liveMap\.read\.own for ADMIN/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^role\.manage for ORG_OPERATOR/ })).toBeNull();
    // Three organization permissions on two platform roles, two platform permissions on two organization roles.
    expect(screen.getAllByText('Not available')).toHaveLength(3 * 2 + 2 * 2);
  });

  it('shows the scope text of an organization permission in its cells only', async () => {
    serve();
    renderPage();
    await loaded();
    expect(screen.getAllByText(/Own organization only/).length).toBeGreaterThan(0);
    const row = screen.getByRole('row', { name: /account\.manage/ });
    expect(within(row).queryByText(/Own organization only/)).toBeNull();
  });

  it('locks a protected permission on ADMIN with its reason', async () => {
    serve();
    renderPage();
    await loaded();
    const locked = screen.getByRole('checkbox', {
      name: 'role.manage for ADMIN, required for Admin',
    }) as HTMLInputElement;
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
    expect(screen.getByText('Required for Admin')).toBeTruthy();
    expect(cell('role.manage', 'STAFF').disabled).toBe(false);
  });

  it('shows what the role below holds as read-only, and frees it when that role loses it', async () => {
    serve();
    renderPage();
    await loaded();
    const inherited = screen.getByRole('checkbox', {
      name: 'liveMap.read.own for ORG_MANAGER, inherited from ORG_OPERATOR, own organization only',
    }) as HTMLInputElement;
    expect(inherited.checked).toBe(true);
    expect(inherited.disabled).toBe(true);
    fireEvent.click(cell('liveMap.read.own', 'ORG_OPERATOR'));
    const freed = cell('liveMap.read.own', 'ORG_MANAGER');
    expect(freed.checked).toBe(false);
    expect(freed.disabled).toBe(false);
  });

  it('keeps Save disabled until a cell differs, counts the changes, and Discard puts the saved set back', async () => {
    serve();
    renderPage();
    await loaded();
    const button = screen.getByRole('button', { name: 'Save permissions' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('No changes');
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    fireEvent.click(cell('account.manage', 'STAFF'));
    expect(button.disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('2 changes in 2 roles');
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(cell('incident.read.own', 'ORG_OPERATOR').checked).toBe(false);
    expect(button.disabled).toBe(true);
  });

  it('marks a changed cell with text, not colour alone, and names it in the box', async () => {
    serve();
    renderPage();
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    expect(
      screen.getByRole('checkbox', {
        name: 'incident.read.own for ORG_OPERATOR, own organization only, changed',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Changed')).toBeTruthy();
  });

  it('confirms with the diff of the one role, then sends its full list and toasts', async () => {
    serve();
    renderPage();
    await loaded();
    fireEvent.click(cell('liveMap.read.own', 'ORG_OPERATOR'));
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    fireEvent.click(cell('incident.respond.own', 'ORG_OPERATOR'));
    save();
    expect(await screen.findByText('Change ORG_OPERATOR: remove 1, add 2?')).toBeTruthy();
    expect(screen.getByText('Holders are affected on their next request.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
    await confirm();
    await waitFor(() => expect(useToast.getState().message).toBe('Permissions updated'));
    const [endpoint, options] = writes()[0] as [string, RequestInit];
    expect(endpoint).toBe('/roles/r-op/permissions');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(String(options.body))).toEqual({
      permissionKeys: ['incident.read.own', 'incident.respond.own'],
    });
    expect(writes()).toHaveLength(1);
  });

  it('writes only the changed roles, in column order, and lists each in the confirmation', async () => {
    serve();
    renderPage();
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    fireEvent.click(cell('account.manage', 'STAFF'));
    save();
    expect(await screen.findByText('Change 2 roles?')).toBeTruthy();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('STAFF')).toBeTruthy();
    expect(dialog.getByText('ORG_OPERATOR')).toBeTruthy();
    await confirm();
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes().map((call) => call[0])).toEqual([
      '/roles/r-staff/permissions',
      '/roles/r-op/permissions',
    ]);
    await waitFor(() => expect(useToast.getState().message).toBe('Permissions updated'));
  });

  it('keeps the draft of the role that failed, names the roles saved and tries the next one', async () => {
    serve((endpoint) => {
      if (endpoint === '/roles/r-staff/permissions') {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Permissions must be an array of keys.');
      }
      return {};
    });
    renderPage();
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    fireEvent.click(cell('account.manage', 'STAFF'));
    save();
    await confirm();
    await waitFor(() =>
      expect(useToast.getState().message).toBe('Permissions updated for ORG_OPERATOR'),
    );
    expect(writes()).toHaveLength(2);
    const banner = within(screen.getByRole('alert'));
    expect(banner.getByText('STAFF')).toBeTruthy();
    expect(banner.getByText('Permissions must be an array of keys.')).toBeTruthy();
    expect(cell('account.manage', 'STAFF').checked).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('1 change in 1 role');
  });

  it('refreshes the signed-in Admin when a saved role is one they hold', async () => {
    serve();
    renderPage();
    await loaded();
    fireEvent.click(cell('account.manage', 'ADMIN'));
    save();
    await confirm();
    await waitFor(() => expect(useToast.getState().message).toBe('Permissions updated'));
    await waitFor(() => expect(reads('/roles').length).toBeGreaterThan(1));
  });

  it('warns the browser before the tab closes while a draft is open', async () => {
    serve();
    renderPage();
    await loaded();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('shows the server message for ADMIN_LOCKOUT in a dialog', async () => {
    serve(() => {
      throw new ApiError(409, 'ADMIN_LOCKOUT', 'Admins must keep the right to manage roles.');
    });
    renderPage();
    await loaded();
    fireEvent.click(cell('account.manage', 'ADMIN'));
    save();
    await confirm();
    expect(await screen.findByText('Admins must keep the right to manage roles.')).toBeTruthy();
    expect(screen.getByText('Admins must keep role management')).toBeTruthy();
  });

  it('keeps the draft, marks the key and reloads for UNKNOWN_PERMISSION', async () => {
    serve(() => {
      throw new ApiError(400, 'UNKNOWN_PERMISSION', 'Unknown permission: incident.read.own.');
    });
    renderPage();
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    save();
    await confirm();
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('Unknown permission: incident.read.own.')).toBeTruthy();
    expect(cell('incident.read.own', 'ORG_OPERATOR').getAttribute('aria-invalid')).toBe('true');
    expect(cell('incident.read.own', 'ORG_OPERATOR').checked).toBe(true);
    expect(screen.getByText(/This permission no longer exists\./)).toBeTruthy();
    await waitFor(() => expect(reads('/roles').length).toBeGreaterThan(1));
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
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    save();
    await confirm();
    expect(
      await screen.findByText('organization.decide cannot be granted to an organization role.'),
    ).toBeTruthy();
  });

  it('toasts "Role not found.", drops that draft and reloads for a 404', async () => {
    serve(() => {
      throw new ApiError(404, 'NOT_FOUND', 'Role not found.');
    });
    renderPage();
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    save();
    await confirm();
    await waitFor(() => expect(useToast.getState().message).toBe('Role not found.'));
    await waitFor(() => expect(reads('/roles').length).toBeGreaterThan(1));
    expect(screen.getByRole('status').textContent).toBe('No changes');
  });

  it('moves focus to the page when every role saved and Save is disabled', async () => {
    serve();
    renderPage();
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    save();
    await confirm();
    await waitFor(() => expect(useToast.getState().message).toBe('Permissions updated'));
    const page = screen.getByRole('region', { name: 'Roles and permissions' });
    await waitFor(() => expect(document.activeElement).toBe(page));
    expect(
      (screen.getByRole('button', { name: 'Save permissions' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('returns focus to Save while a failed role keeps the draft open and another role saved', async () => {
    serve((endpoint) => {
      if (endpoint === '/roles/r-staff/permissions') {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Permissions must be an array of keys.');
      }
      return {};
    });
    renderPage();
    await loaded();
    fireEvent.click(cell('account.manage', 'STAFF'));
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    save();
    await confirm();
    await screen.findByRole('alert');
    const button = screen.getByRole('button', { name: 'Save permissions' });
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('drops a key the reloaded catalog no longer holds, so the next save is not blocked by it', async () => {
    let permissionReads = 0;
    api.mockImplementation((endpoint: string, options?: RequestInit) => {
      if (options?.method) {
        return Promise.reject(
          new ApiError(400, 'UNKNOWN_PERMISSION', 'Unknown permission: incident.read.own.'),
        );
      }
      if (endpoint === '/roles') return Promise.resolve(ROLES);
      permissionReads += 1;
      return Promise.resolve(
        permissionReads === 1
          ? CATALOG
          : CATALOG.filter((item) => item.key !== 'incident.read.own'),
      );
    });
    renderPage();
    await loaded();
    fireEvent.click(cell('incident.read.own', 'ORG_OPERATOR'));
    fireEvent.click(cell('liveMap.read.own', 'ORG_OPERATOR'));
    save();
    await confirm();
    await screen.findByRole('alert');
    await waitFor(() =>
      expect(screen.queryByText(/This permission no longer exists\./)).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /^incident\.read\.own/ })).toBeNull(),
    );
    expect(screen.getByRole('status').textContent).toBe('1 change in 1 role');
  });

  it('shows MSG26 alone for a 403', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this.');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('RolesPage (screen 7.2), under 768 px', () => {
  const narrow = () =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    );

  it('shows one role at a time from a select, with the cell states of the grid', async () => {
    narrow();
    serve();
    renderPage();
    await screen.findByLabelText('Role');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'ADMIN' })).toBeTruthy();
    const roleManage = screen.getByRole('checkbox', { name: /^role\.manage/ }) as HTMLInputElement;
    expect(roleManage.checked).toBe(true);
    expect(roleManage.disabled).toBe(true);
    expect(screen.getByText(/Required for Admin\./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'r-mgr' } });
    expect(screen.getByRole('heading', { name: 'ORG_MANAGER' })).toBeTruthy();
    const inherited = screen.getByRole('checkbox', {
      name: /^liveMap\.read\.own/,
    }) as HTMLInputElement;
    expect(inherited.disabled).toBe(true);
    expect(screen.getByText(/From ORG_OPERATOR\./)).toBeTruthy();
  });

  it('says nothing about scope for a platform permission and names it for an own one', async () => {
    narrow();
    serve();
    renderPage();
    await screen.findByLabelText('Role');
    expect(screen.queryByText(/Any organization/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'r-op' } });
    expect(screen.getAllByText(/Own organization only\./).length).toBeGreaterThan(0);
  });

  it('keeps one draft across roles and saves each changed role', async () => {
    narrow();
    serve();
    renderPage();
    await screen.findByLabelText('Role');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'r-op' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /^incident\.read\.own/ }));
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'r-staff' } });
    expect(screen.getByText('This role holds no permissions.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /^account\.manage/ }));
    expect(screen.getByRole('status').textContent).toBe('2 changes in 2 roles');
    save();
    await confirm();
    await waitFor(() => expect(writes()).toHaveLength(2));
  });
});
