// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from '../shared/ui';
import { ComplianceCasePage } from './ComplianceCasePage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

let isAdmin = false;
vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { roles: [isAdmin ? 'ADMIN' : 'STAFF'] } }),
}));

const DETAIL = '/compliance-cases/case-1';
const STATIONS = '/organizations/org-1/field-stations';

const theCase = (overrides: Record<string, unknown> = {}) => ({
  id: 'case-1',
  code: 'CMP-0002',
  organization: { id: 'org-1', code: 'ORG-0007' },
  type: 'SUSPECTED_THEFT',
  status: 'OPEN',
  evidence: 'Three devices unreturned 40 days after default',
  linkedContractIds: [],
  linkedLossCases: [],
  authorityReference: null,
  outcome: null,
  openedAt: '2026-10-20T03:15:00.000Z',
  actions: [],
  ...overrides,
});

const serve = (
  detail: () => unknown,
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint === DETAIL && !options?.method) return Promise.resolve(detail());
    if (endpoint === STATIONS) {
      return Promise.resolve({
        items: [{ id: 'fs-1', name: 'Office laptop', mqttUsername: 'fs-org-0007-1', revokedAt: null }],
        limit: 5,
      });
    }
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/compliance-cases/case-1']}>
        <Routes>
          <Route path="/t/compliance-cases/:id" element={<ComplianceCasePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  isAdmin = false;
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('ComplianceCasePage (screen 3.6)', () => {
  it('shows the case evidence, organization and that it offers both actions while OPEN', async () => {
    serve(() => theCase());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'CMP-0002, Open' })).toBeTruthy();
    expect(screen.getByText('Three devices unreturned 40 days after default')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close case' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take an action' })).toBeTruthy();
    expect(screen.getByText('No actions taken yet.')).toBeTruthy();
  });

  it('is read only once closed: no Close case or Take an action control', async () => {
    serve(() => theCase({ status: 'CLOSED', outcome: 'Settled', authorityReference: 'CA-PD-2026-118' }));
    renderPage();
    await screen.findByRole('heading', { name: 'CMP-0002, Closed' });
    expect(screen.queryByRole('button', { name: 'Close case' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take an action' })).toBeNull();
    expect(screen.getByText('Settled')).toBeTruthy();
    expect(screen.getByText('CA-PD-2026-118')).toBeTruthy();
  });

  it('blocks closing a suspected theft case without a police report reference (BR-40)', async () => {
    serve(
      () => theCase(),
      () => {
        throw new Error('close must not be called without a reference');
      },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'CMP-0002, Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Close case' }));
    const dialog = screen.getByRole('dialog', { name: 'Close case CMP-0002?' });
    fireEvent.change(within(dialog).getByLabelText(/^Outcome/), { target: { value: 'Devices recovered' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close case' }));
    expect(await within(dialog).findByText('Police report reference is required.')).toBeTruthy();
  });

  it('closes the case once the police report reference is given, and toasts', async () => {
    serve(
      () => theCase(),
      (endpoint, options) => {
        expect(endpoint).toBe('/compliance-cases/case-1/close');
        expect(JSON.parse((options?.body as string) ?? '{}')).toEqual({
          outcome: 'Devices recovered',
          authorityReference: 'CA-PD-2026-118',
        });
        return theCase({ status: 'CLOSED', outcome: 'Devices recovered', authorityReference: 'CA-PD-2026-118' });
      },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'CMP-0002, Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Close case' }));
    const dialog = screen.getByRole('dialog', { name: 'Close case CMP-0002?' });
    fireEvent.change(within(dialog).getByLabelText(/^Outcome/), { target: { value: 'Devices recovered' } });
    fireEvent.change(within(dialog).getByLabelText(/Police report reference/), { target: { value: 'CA-PD-2026-118' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close case' }));
    await screen.findByRole('heading', { name: 'CMP-0002, Closed' });
    expect(useToast.getState().message).toBe('Compliance case closed');
  });

  it('disables SUSPEND_ORGANIZATION for Staff with the api-design 30 hint', async () => {
    serve(() => theCase());
    renderPage();
    await screen.findByRole('heading', { name: 'CMP-0002, Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Take an action' }));
    const dialog = screen.getByRole('dialog', { name: 'Take an action on CMP-0002' });
    expect(within(dialog).getByText('Ask a TrekLink Admin to suspend the organization.')).toBeTruthy();
    const suspendOption = within(dialog).getByRole('option', { name: /Suspend organization \(Admin only\)/ });
    expect((suspendOption as HTMLOptionElement).disabled).toBe(true);
  });

  it('records a Field Station revocation action, picking the target from the live list', async () => {
    serve(
      () => theCase(),
      (endpoint, options) => {
        expect(endpoint).toBe('/compliance-cases/case-1/actions');
        expect(JSON.parse((options?.body as string) ?? '{}')).toEqual({
          kind: 'REVOKE_FIELD_STATION',
          targetId: 'fs-1',
          note: 'Stolen',
        });
        return theCase({
          actions: [{ kind: 'REVOKE_FIELD_STATION', actor: { id: 'u-staff', fullName: 'Tran Thi B' }, at: '2026-10-30T03:00:00.000Z' }],
        });
      },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'CMP-0002, Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Take an action' }));
    const dialog = screen.getByRole('dialog', { name: 'Take an action on CMP-0002' });
    fireEvent.change(within(dialog).getByLabelText(/^Action/), { target: { value: 'REVOKE_FIELD_STATION' } });
    await within(dialog).findByText('Office laptop (fs-org-0007-1)');
    fireEvent.change(within(dialog).getByLabelText(/^Target/), { target: { value: 'fs-1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: 'Stolen' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record action' }));
    await screen.findByText('Revoke Field Station');
    expect(useToast.getState().message).toBe('Action recorded');
  });

  it('lets an Admin pick SUSPEND_ORGANIZATION', async () => {
    isAdmin = true;
    serve(() => theCase());
    renderPage();
    await screen.findByRole('heading', { name: 'CMP-0002, Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Take an action' }));
    const dialog = screen.getByRole('dialog', { name: 'Take an action on CMP-0002' });
    const suspendOption = within(dialog).getByRole('option', { name: 'Suspend organization' });
    expect((suspendOption as HTMLOptionElement).disabled).toBe(false);
  });
});
