// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { OrganizationDetailPage } from './OrganizationDetailPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const ID = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const READ = 'incident.read.own';
const RESPOND = 'incident.respond.own';
const ROLE = 'organizationRole.manage.own';

const organization = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  code: 'ORG-0007',
  legalName: 'ACME Trek Co., Ltd.',
  taxCode: '0312345678',
  address: '12 Nguyen Hue, District 1',
  contactEmail: 'ops@acme-trek.vn',
  contactPhone: '0281234567',
  status: 'SUSPENDED',
  statusChangedAt: '2026-11-02T03:15:00.000Z',
  verifiedAt: '2026-10-20T03:15:00.000Z',
  decidedAt: '2026-10-20T03:15:00.000Z',
  channelKeyVersion: 2,
  channelKeyExposedAt: null,
  version: 3,
  verification: {
    method: 'IN_PERSON',
    documentsSeen: ['Business registration', 'Manager ID card'],
    masterContractRef: 'MC-2026-0007',
    verifiedBy: 'Tran Thi B',
  },
  counts: { members: 4, runningContracts: 1, openIncidents: 0 },
  ...overrides,
});

const roles = {
  roles: [
    {
      key: 'ORG_MANAGER',
      version: 2,
      baselineKeys: [READ, RESPOND, ROLE],
      effectiveKeys: [READ, RESPOND, ROLE],
    },
    { key: 'ORG_OPERATOR', version: 1, baselineKeys: [READ, RESPOND], effectiveKeys: [READ] },
  ],
  catalog: [
    {
      key: READ,
      action: 'read',
      subject: 'Incident',
      scope: 'own',
      accountType: 'ORGANIZATION',
      description: 'Read incidents',
      protected: false,
    },
    {
      key: RESPOND,
      action: 'respond',
      subject: 'Incident',
      scope: 'own',
      accountType: 'ORGANIZATION',
      description: 'Respond to incidents',
      protected: false,
    },
    {
      key: ROLE,
      action: 'manage',
      subject: 'OrganizationRole',
      scope: 'own',
      accountType: 'ORGANIZATION',
      description: 'Manage roles',
      protected: true,
    },
  ],
};

const history = [
  {
    fromStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    actor: 'SYSTEM',
    reason: 'Contract CT-0001 defaulted',
    createdAt: '2026-11-02T03:15:00.000Z',
  },
];

const serve = (handlers: Record<string, () => unknown>) =>
  api.mockImplementation((endpoint: string) => {
    const handler = handlers[endpoint];
    return handler ? Promise.resolve().then(handler) : Promise.reject(new Error(endpoint));
  });

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/t/organizations/${ID}`]}>
        <Routes>
          <Route path="/t/organizations/:id" element={<OrganizationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('OrganizationDetailPage (screen 3.2, read-only roles of 3.7)', () => {
  beforeEach(() => {
    api.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the record, the verification, the status history and the roles read only', async () => {
    serve({
      [`/organizations/${ID}`]: () => organization(),
      [`/organizations/${ID}/transitions`]: () => history,
      [`/organizations/${ID}/roles`]: () => roles,
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'ACME Trek Co., Ltd.' })).toBeTruthy();
    expect(screen.getByText('0312345678')).toBeTruthy();
    expect(screen.getByText('MC-2026-0007')).toBeTruthy();
    expect(screen.getByText('Tran Thi B')).toBeTruthy();
    expect(await screen.findByText(/Contract CT-0001 defaulted/)).toBeTruthy();

    const grid = await screen.findByRole('table', {
      name: 'Permissions by role of this organization',
    });
    const boxes = within(grid).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset to TrekLink default/ })).toBeNull();
    expect(api).toHaveBeenCalledWith(`/organizations/${ID}/roles`);
    expect(api.mock.calls.every((call) => !(call[1] as RequestInit | undefined)?.method)).toBe(
      true,
    );
  });

  it('shows one role at a time in a select below 768 px, every box disabled', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    serve({
      [`/organizations/${ID}`]: () => organization(),
      [`/organizations/${ID}/transitions`]: () => history,
      [`/organizations/${ID}/roles`]: () => roles,
    });
    renderPage();

    const select = (await screen.findByLabelText('Role')) as HTMLSelectElement;
    expect(screen.queryByRole('region', { name: 'Permissions by role' })).toBeNull();
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    const manager = await screen.findByRole('heading', { name: 'ORG_MANAGER' });
    const boxes = within(manager.closest('section, div') as HTMLElement).queryAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);

    fireEvent.change(select, { target: { value: select.options[1].value } });
    expect(await screen.findByRole('heading', { name: 'ORG_OPERATOR' })).toBeTruthy();
    const all = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(all.every((box) => box.disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });

  it('gives the way back a 24 px target', async () => {
    serve({
      [`/organizations/${ID}`]: () => organization(),
      [`/organizations/${ID}/transitions`]: () => history,
      [`/organizations/${ID}/roles`]: () => roles,
    });
    renderPage();

    expect(
      (await screen.findByRole('link', { name: 'Back to organizations' })).className,
    ).toContain('min-h-6');
  });

  it('says so when the organization was not verified at the counter', async () => {
    serve({
      [`/organizations/${ID}`]: () =>
        organization({ status: 'PENDING', verifiedAt: null, verification: null }),
      [`/organizations/${ID}/transitions`]: () => [],
      [`/organizations/${ID}/roles`]: () => roles,
    });
    renderPage();

    expect(await screen.findByText('Not verified at the counter yet.')).toBeTruthy();
    expect(await screen.findByText('No status change yet.')).toBeTruthy();
  });

  it('answers with the access message (MSG26) and a way back for an unknown organization', async () => {
    api.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Organization not found.'));
    renderPage();

    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to organizations' }).getAttribute('href')).toBe(
      '/t/organizations',
    );
  });

  it('keeps the record when only the roles fail, with a retry', async () => {
    serve({
      [`/organizations/${ID}`]: () => organization(),
      [`/organizations/${ID}/transitions`]: () => history,
      [`/organizations/${ID}/roles`]: () => {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.');
      },
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'ACME Trek Co., Ltd.' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
