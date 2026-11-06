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

const CASES_ALL = '/compliance-cases?pageNumber=1&pageSize=20';
const ORGS = '/organizations?pageSize=100';
const CONTRACTS = '/contracts?organizationId=org-1&pageNumber=1&pageSize=100';
const LOSS_CASES = '/loss-cases?organizationId=org-1&pageNumber=1&pageSize=100';

const page = (items: unknown[], totalCount = items.length) => ({
  items,
  pageNumber: 1,
  pageSize: 100,
  totalCount,
  totalPages: 1,
});

const serve = (
  casesList: () => unknown,
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint === CASES_ALL && !options?.method) return Promise.resolve(casesList());
    if (endpoint === CONTRACTS) {
      return Promise.resolve(
        page([
          { id: 'c-1', code: 'CT-0001', status: 'DEFAULTED' },
          { id: 'c-2', code: 'CT-0002', status: 'ACTIVE' },
        ]),
      );
    }
    if (endpoint === LOSS_CASES) {
      return Promise.resolve(
        page([{ id: 'lc-1', code: 'LOSS-0003', state: 'SEARCHING', device: { id: 'd-1', assetTag: 'TL-0042' } }]),
      );
    }
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
  it('opens on All and lists cases with their type, linked items and status', async () => {
    serve(() => ({ items: [theCase()], pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1 }));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Compliance cases' });
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
    expect(api).toHaveBeenCalledWith(CASES_ALL);
    expect(within(table).getByText('CMP-0002')).toBeTruthy();
    expect(within(table).getByText('ORG-0007')).toBeTruthy();
    expect(within(table).getByText('Suspected theft')).toBeTruthy();
    expect(within(table).getByText('1 contract, 1 loss case')).toBeTruthy();
    expect(within(table).getByText('Open')).toBeTruthy();
    expect(screen.getByText('1 case')).toBeTruthy();
  });

  it('opens a case from its details pane on CollectionView (D-096)', async () => {
    serve(() => ({
      items: [theCase(), theCase({ id: 'case-2', code: 'CMP-0003' }), theCase({ id: 'case-3', code: 'CMP-0004' })],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 3,
      totalPages: 1,
    }));
    renderPage();
    await screen.findByRole('table', { name: 'Compliance cases' });
    expect(screen.getByRole('group', { name: 'Compliance cases: commands' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show details of CMP-0003' }));
    fireEvent.click(screen.getByRole('link', { name: 'Open the case' }));
    expect(await screen.findByText('case detail page')).toBeTruthy();
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

  it('offers the contracts and loss cases of the chosen organization and sends the chosen ids', async () => {
    serve(
      () => ({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 }),
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/compliance-cases');
        expect(JSON.parse((options?.body as string) ?? '{}')).toMatchObject({
          linkedContractIds: ['c-2'],
          linkedLossCaseIds: ['lc-1'],
        });
        return theCase();
      },
    );
    renderPage();
    await screen.findByText('No compliance cases here.');
    fireEvent.click(screen.getByRole('button', { name: 'Open case' }));
    const form = await screen.findByRole('dialog', { name: 'Open compliance case' });
    expect(within(form).queryByText('Linked contracts (optional)')).toBeNull();
    await screen.findByText('ORG-0007, Ta Nang Treks');
    fireEvent.change(within(form).getByLabelText(/^Organization/), { target: { value: 'org-1' } });

    const contract = await within(form).findByRole('checkbox', { name: /CT-0002/ });
    expect(within(form).getByRole('checkbox', { name: /CT-0001/ })).toBeTruthy();
    expect(within(form).getByText('Defaulted')).toBeTruthy();
    fireEvent.click(contract);
    fireEvent.click(await within(form).findByRole('checkbox', { name: /LOSS-0003/ }));
    expect(api).toHaveBeenCalledWith(CONTRACTS);
    expect(api).toHaveBeenCalledWith(LOSS_CASES);

    fireEvent.change(within(form).getByLabelText(/^Type/), { target: { value: 'SUSPECTED_THEFT' } });
    fireEvent.change(within(form).getByLabelText(/^Evidence/), { target: { value: 'Devices unreturned' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Open case' }));
    expect(await screen.findByText('case detail page')).toBeTruthy();
  });

  it('clears the chosen links when the organization changes', async () => {
    serve(() => ({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 }));
    renderPage();
    await screen.findByText('No compliance cases here.');
    fireEvent.click(screen.getByRole('button', { name: 'Open case' }));
    const form = await screen.findByRole('dialog', { name: 'Open compliance case' });
    await screen.findByText('ORG-0007, Ta Nang Treks');
    const select = within(form).getByLabelText(/^Organization/);
    fireEvent.change(select, { target: { value: 'org-1' } });
    fireEvent.click(await within(form).findByRole('checkbox', { name: /CT-0001/ }));
    fireEvent.change(select, { target: { value: '' } });
    expect(within(form).queryByRole('checkbox', { name: /CT-0001/ })).toBeNull();
    fireEvent.change(select, { target: { value: 'org-1' } });
    const again = (await within(form).findByRole('checkbox', { name: /CT-0001/ })) as HTMLInputElement;
    expect(again.checked).toBe(false);
  });

  it('says so when the organization has no contract or loss case', async () => {
    api.mockImplementation((endpoint: string) => {
      if (endpoint === CASES_ALL) return Promise.resolve(page([], 0));
      if (endpoint === ORGS) {
        return Promise.resolve({
          items: [{ id: 'org-1', code: 'ORG-0007', legalName: 'Ta Nang Treks', status: 'ACTIVE' }],
          totalCount: 1,
        });
      }
      return Promise.resolve(page([]));
    });
    renderPage();
    await screen.findByText('No compliance cases here.');
    fireEvent.click(screen.getByRole('button', { name: 'Open case' }));
    const form = await screen.findByRole('dialog', { name: 'Open compliance case' });
    await screen.findByText('ORG-0007, Ta Nang Treks');
    fireEvent.change(within(form).getByLabelText(/^Organization/), { target: { value: 'org-1' } });
    expect(await within(form).findByText('No contracts for this organization.')).toBeTruthy();
    expect(within(form).getByText('No loss cases for this organization.')).toBeTruthy();
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
