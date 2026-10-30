// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { ComplianceCasesPage } from './ComplianceCasesPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const theCase = (overrides: Record<string, unknown> = {}) => ({
  id: 'case-1',
  code: 'CMP-0002',
  organization: { id: 'org-1', code: 'ORG-0007' },
  type: 'SUSPECTED_THEFT',
  status: 'OPEN',
  evidence: 'Three devices unreturned 40 days after default',
  linkedContractIds: ['c-1'],
  linkedLossCases: ['LOSS-0003'],
  authorityReference: null,
  outcome: null,
  openedAt: '2026-10-20T03:15:00.000Z',
  actions: [],
  ...overrides,
});

const CASES_OPEN = '/compliance-cases?pageNumber=1&pageSize=20&status=OPEN';
const ORGS = '/organizations?pageSize=100';

const serve = (
  casesList: () => unknown,
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint === CASES_OPEN && !options?.method) return Promise.resolve(casesList());
    if (endpoint === ORGS) {
      return Promise.resolve({
        items: [{ id: 'org-1', code: 'ORG-0007', legalName: 'Ta Nang Treks', status: 'ACTIVE' }],
        totalCount: 1,
      });
    }
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/compliance-cases']}>
        <Routes>
          <Route path="/t/compliance-cases" element={<ComplianceCasesPage />} />
          <Route path="/t/compliance-cases/:id" element={<div>case detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('ComplianceCasesPage (screen 3.6)', () => {
  it('lists open cases with their type, linked items and status', async () => {
    serve(() => ({ items: [theCase()], pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1 }));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Compliance cases' });
    expect(within(table).getByText('CMP-0002')).toBeTruthy();
    expect(within(table).getByText('ORG-0007')).toBeTruthy();
    expect(within(table).getByText('Suspected theft')).toBeTruthy();
    expect(within(table).getByText('1 contract, 1 loss case')).toBeTruthy();
    expect(within(table).getByText('Open')).toBeTruthy();
    expect(screen.getByText('1 case')).toBeTruthy();
  });

  it('shows the empty state for a tab with no case', async () => {
    serve(() => ({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 }));
    renderPage();
    expect(await screen.findByText('No compliance cases here.')).toBeTruthy();
  });

  it('shows the list error with a retry', async () => {
    api.mockImplementationOnce(() => Promise.reject(new ApiError(500, 'INTERNAL', 'Database unavailable.')));
    renderPage();
    expect(await screen.findByText('Database unavailable.')).toBeTruthy();
  });

  it('opens a case and navigates to its detail page', async () => {
    serve(
      () => ({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 }),
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/compliance-cases');
        expect(JSON.parse((options?.body as string) ?? '{}')).toEqual({
          type: 'SUSPECTED_THEFT',
          evidence: 'Devices unreturned',
          linkedContractIds: [],
          linkedLossCaseIds: [],
        });
        return theCase();
      },
    );
    renderPage();
    await screen.findByText('No compliance cases here.');
    fireEvent.click(screen.getByRole('button', { name: 'Open case' }));

    const form = await screen.findByRole('dialog', { name: 'Open compliance case' });
    const orgSelect = within(form).getByLabelText(/^Organization/);
    await screen.findByText('ORG-0007, Ta Nang Treks');
    fireEvent.change(orgSelect, { target: { value: 'org-1' } });
    fireEvent.change(within(form).getByLabelText(/^Type/), { target: { value: 'SUSPECTED_THEFT' } });
    fireEvent.change(within(form).getByLabelText(/^Evidence/), { target: { value: 'Devices unreturned' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Open case' }));

    expect(await screen.findByText('case detail page')).toBeTruthy();
    expect(useToast.getState().message).toBe('Compliance case opened');
  });

  it('refuses a blank evidence field without calling the server (MSG02)', async () => {
    serve(() => ({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 }));
    renderPage();
    await screen.findByText('No compliance cases here.');
    fireEvent.click(screen.getByRole('button', { name: 'Open case' }));
    const form = await screen.findByRole('dialog', { name: 'Open compliance case' });
    fireEvent.change(within(form).getByLabelText(/^Organization/), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Open case' }));
    expect(await within(form).findByText('Organization is required.')).toBeTruthy();
    expect(within(form).getByText('Type is required.')).toBeTruthy();
    expect(within(form).getByText('Evidence is required.')).toBeTruthy();
    expect(api.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });
});
