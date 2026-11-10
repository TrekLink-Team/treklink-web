// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { OrganizationRolesPage } from './OrganizationRolesPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

// The status the API reports for the organization; the session below was signed in while it was PENDING.
let status = 'ACTIVE';
vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'm-1', roles: ['ORG_MANAGER'], organization: { id: 'org-a', status: 'PENDING' } },
  }),
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

const READ = 'incident.read.own';
const RESPOND = 'incident.respond.own';
const MEMBER = 'member.manage.own';
const ROLE = 'organizationRole.manage.own';

const view = (operatorEffective = [READ, RESPOND], version = 0) => ({
  roles: [
    {
      key: 'ORG_MANAGER',
      version: 2,
      baselineKeys: [READ, RESPOND, MEMBER, ROLE],
      effectiveKeys: [READ, RESPOND, MEMBER, ROLE],
    },
    {
      key: 'ORG_OPERATOR',
      version,
      baselineKeys: [READ, RESPOND],
      effectiveKeys: operatorEffective,
    },
  ],
  catalog: [
    permission(READ),
    permission(RESPOND),
    permission(MEMBER),
    permission(ROLE, { protected: true }),
  ],
});

const serve = (
  data = view(),
  respond: (endpoint: string, options?: RequestInit) => unknown = () => ({}),
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint === '/organizations/org-a') return Promise.resolve({ id: 'org-a', status });
    if (!options?.method) return Promise.resolve(data);
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <OrganizationRolesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const writes = () => api.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method);
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as unknown;
const cell = (key: string, role: string) =>
  screen.getByRole('checkbox', {
    name: new RegExp(`^${key.replace(/\./g, '\\.')} for ${role}(,|$)`),
  }) as HTMLInputElement;
const named = (key: string) => new RegExp('^' + key.split('.').join('[.]'));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
const confirm = async () =>
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save permissions' }),
  );
// The grid and the organization status are two reads; the controls follow the status.
const loaded = async () => {
  const grid = await screen.findByRole('table', {
    name: 'Permissions by role of your organization',
  });
  if (status === 'ACTIVE') await screen.findByRole('button', { name: 'Save permissions' });
  else await screen.findByText(/can be read but not changed/);
  return grid;
};

beforeEach(() => {
  api.mockReset();
  status = 'ACTIVE';
  useToast.getState().dismiss();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrganizationRolesPage (screen 3.7), the grid', () => {
  it('is one table with the Manager and the Operator as columns, read once', async () => {
    serve();
    renderPage();
    await loaded();

    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent ?? '');
    expect(headers[0]).toBe('Permission');
    expect(headers[1]).toContain('ORG_MANAGER');
    expect(headers[2]).toContain('ORG_OPERATOR');
    expect(api.mock.calls.filter((call) => call[0] === '/organization/roles')).toHaveLength(1);
  });

  it('locks the protected permission on the Manager and gives it no box on the Operator', async () => {
    serve();
    renderPage();
    await loaded();

    expect(cell(ROLE, 'ORG_MANAGER').disabled).toBe(true);
    expect(cell(ROLE, 'ORG_MANAGER').getAttribute('aria-label')).toContain('required for Manager');
    expect(
      screen.queryByRole('checkbox', {
        name: new RegExp(`^${ROLE.replace(/\./g, '\\.')} for ORG_OPERATOR`),
      }),
    ).toBeNull();
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });

  it('shows what the Operator baseline holds as read-only on the Manager, whatever the Operator draft says', async () => {
    serve();
    renderPage();
    await loaded();
    expect(cell(RESPOND, 'ORG_MANAGER').disabled).toBe(true);
    expect(cell(RESPOND, 'ORG_MANAGER').getAttribute('aria-label')).toContain(
      'inherited from ORG_OPERATOR',
    );

    fireEvent.click(cell(RESPOND, 'ORG_OPERATOR'));

    expect(cell(RESPOND, 'ORG_OPERATOR').checked).toBe(false);
    expect(cell(RESPOND, 'ORG_MANAGER').checked).toBe(true);
    expect(cell(RESPOND, 'ORG_MANAGER').disabled).toBe(true);
    expect(cell(MEMBER, 'ORG_MANAGER').disabled).toBe(false);
  });

  it('marks a customised cell with text and names it in the box', async () => {
    serve(view([READ]));
    renderPage();
    await loaded();

    expect(cell(RESPOND, 'ORG_OPERATOR').getAttribute('aria-label')).toContain('customised');
    expect(screen.getAllByText(/Customised/).length).toBeGreaterThan(0);
    expect(cell(READ, 'ORG_OPERATOR').getAttribute('aria-label')).not.toContain('customised');
  });
});

describe('OrganizationRolesPage (screen 3.7), saving', () => {
  it('confirms with the diff, sends the full list with the version read, and toasts', async () => {
    serve(view(), () => ({ key: 'ORG_OPERATOR', version: 1, effectiveKeys: [READ] }));
    renderPage();
    await loaded();
    fireEvent.click(cell(RESPOND, 'ORG_OPERATOR'));
    expect(screen.getByRole('status').textContent).toBe('1 change in 1 role');

    save();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Change ORG_OPERATOR: remove 1?')).toBeTruthy();
    expect(within(dialog).getByText(RESPOND)).toBeTruthy();
    await confirm();

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/organization/roles/ORG_OPERATOR/permissions');
    expect(body(writes()[0])).toEqual({ permissionKeys: [READ], expectedVersion: 0 });
    await waitFor(() => expect(useToast.getState().message).toBe('Permissions updated'));
  });

  it('sends the Manager list with the inherited and protected keys and the Manager version', async () => {
    serve(view(), () => ({}));
    renderPage();
    await loaded();
    fireEvent.click(cell(MEMBER, 'ORG_MANAGER'));
    save();
    await confirm();

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/organization/roles/ORG_MANAGER/permissions');
    expect(body(writes()[0])).toEqual({
      permissionKeys: [READ, RESPOND, ROLE].sort(),
      expectedVersion: 2,
    });
  });

  it('resets one role to the TrekLink default as a draft', async () => {
    serve(view([READ]));
    renderPage();
    await loaded();
    const reset = screen.getByRole('button', {
      name: 'Reset to TrekLink default for ORG_OPERATOR',
    });

    fireEvent.click(reset);

    expect(cell(RESPOND, 'ORG_OPERATOR').checked).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('1 change in 1 role');
    expect(writes()).toHaveLength(0);
  });

  it('disables Reset for a role that already holds its default', async () => {
    serve();
    renderPage();
    await loaded();
    const reset = screen.getByRole('button', {
      name: 'Reset to TrekLink default for ORG_OPERATOR',
    });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the draft and offers Reload for STALE_VERSION', async () => {
    serve(view(), () => {
      throw new ApiError(409, 'STALE_VERSION', 'The permissions of this role changed.');
    });
    renderPage();
    await loaded();
    fireEvent.click(cell(RESPOND, 'ORG_OPERATOR'));
    save();
    await confirm();

    const dialog = await screen.findByRole('dialog', { name: 'Someone else changed this' });
    expect(cell(RESPOND, 'ORG_OPERATOR').checked).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));

    await waitFor(() =>
      expect(
        api.mock.calls.filter((call) => call[0] === '/organization/roles').length,
      ).toBeGreaterThan(1),
    );
    expect(cell(RESPOND, 'ORG_OPERATOR').checked).toBe(false);
  });

  it('shows the server message for MANAGER_LOCKOUT in a dialog', async () => {
    serve(view(), () => {
      throw new ApiError(409, 'MANAGER_LOCKOUT', 'Managers must keep the right to manage roles.');
    });
    renderPage();
    await loaded();
    fireEvent.click(cell(MEMBER, 'ORG_MANAGER'));
    save();
    await confirm();

    const dialog = await screen.findByRole('dialog', {
      name: 'Managers must keep role management',
    });
    expect(within(dialog).getByText('Managers must keep the right to manage roles.')).toBeTruthy();
  });

  it('marks the key, keeps the draft and reloads for PERMISSION_OUT_OF_CEILING', async () => {
    serve(view(), () => {
      throw new ApiError(
        400,
        'PERMISSION_OUT_OF_CEILING',
        `${RESPOND} cannot be granted to this role.`,
      );
    });
    renderPage();
    await loaded();
    fireEvent.click(cell(READ, 'ORG_OPERATOR'));
    save();
    await confirm();

    expect(await screen.findByText(`${RESPOND} cannot be granted to this role.`)).toBeTruthy();
    expect(cell(READ, 'ORG_OPERATOR').checked).toBe(false);
    expect(screen.getByText(/This permission no longer exists/)).toBeTruthy();
  });

  it('keeps the draft of the role that failed, names the roles saved and tries the next one', async () => {
    serve(view(), (endpoint) => {
      if (endpoint.includes('ORG_MANAGER')) return { key: 'ORG_MANAGER' };
      throw new ApiError(400, 'VALIDATION_FAILED', 'permissionKeys is invalid.');
    });
    renderPage();
    await loaded();
    fireEvent.click(cell(MEMBER, 'ORG_MANAGER'));
    fireEvent.click(cell(RESPOND, 'ORG_OPERATOR'));
    save();
    await confirm();

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(await screen.findByText('permissionKeys is invalid.')).toBeTruthy();
    await waitFor(() =>
      expect(useToast.getState().message).toBe('Permissions updated for ORG_MANAGER'),
    );
    expect(cell(RESPOND, 'ORG_OPERATOR').checked).toBe(false);
  });

  it('warns the browser before the tab closes while a draft is open', async () => {
    serve();
    renderPage();
    await loaded();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    fireEvent.click(cell(RESPOND, 'ORG_OPERATOR'));
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
  });
});

describe('OrganizationRolesPage (screen 3.7), states', () => {
  it('reads but does not change while the organization is not ACTIVE', async () => {
    status = 'SUSPENDED';
    serve();
    renderPage();
    await loaded();

    expect(
      screen.getByText(
        /Role permissions can be read but not changed while your organization is suspended/,
      ),
    ).toBeTruthy();
    expect(cell(RESPOND, 'ORG_OPERATOR').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset to TrekLink default/ })).toBeNull();
  });

  it('reads the status from the API, so an approval since sign-in enables the grid', async () => {
    serve();
    renderPage();
    await loaded();

    expect(screen.queryByText(/can be read but not changed/)).toBeNull();
    expect(cell(RESPOND, 'ORG_OPERATOR').disabled).toBe(false);
  });

  it('keeps the grid read-only, without a warning, until the status is known', async () => {
    api.mockImplementation((endpoint: string) =>
      endpoint === '/organizations/org-a' ? new Promise(() => undefined) : Promise.resolve(view()),
    );
    renderPage();
    await screen.findByRole('table', { name: 'Permissions by role of your organization' });

    expect(cell(RESPOND, 'ORG_OPERATOR').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
    expect(screen.queryByText(/can be read but not changed/)).toBeNull();
  });

  it('says so when the status cannot be read, and stays read-only', async () => {
    api.mockImplementation((endpoint: string) =>
      endpoint === '/organizations/org-a'
        ? Promise.reject(new ApiError(500, 'INTERNAL', 'Something went wrong.'))
        : Promise.resolve(view()),
    );
    renderPage();

    expect(
      await screen.findByText(/The status of your organization could not be read/),
    ).toBeTruthy();
    expect(cell(RESPOND, 'ORG_OPERATOR').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });

  it('shows MSG26 alone for a 403', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You do not have access to this.'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('OrganizationRolesPage (screen 3.7), under 768 px', () => {
  it('shows one role at a time from a select, with the cell states of the grid and Reset', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    );
    serve(view([READ]));
    renderPage();
    await screen.findByLabelText('Role');
    await screen.findByRole('button', { name: 'Save permissions' });

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'ORG_MANAGER' })).toBeTruthy();
    const required = screen.getByRole('checkbox', {
      name: named(ROLE),
    });
    expect((required as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Required for Manager\./)).toBeTruthy();
    expect(screen.getAllByText(/From ORG_OPERATOR\./).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ORG_OPERATOR' } });
    expect(screen.getByRole('heading', { name: 'ORG_OPERATOR' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: named(ROLE) })).toBeNull();
    expect(screen.getByText(/Customised\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to TrekLink default' }));
    expect(screen.getByRole('status').textContent).toBe('1 change in 1 role');
  });
});
