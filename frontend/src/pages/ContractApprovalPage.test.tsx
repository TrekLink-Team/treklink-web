// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContractApprovalPage } from './ContractApprovalPage';

const approveContract = vi.fn();

const requested = {
  id: 'c-1',
  code: 'RC-2026-0004',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
  planType: 'MONTHLY',
  dayPlanDays: null,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  quantity: 5,
  requestedStartDate: '2099-01-02',
  monthlyUnitPriceVnd: 450_000,
  dayPremium: null,
  holdingFeeRatio: 0.5,
  status: 'REQUESTED',
  version: 1,
};

vi.mock('../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/contract/api')>()),
  useContracts: () => ({
    isLoading: false,
    data: { items: [requested], pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1 },
  }),
  useAvailability: () => ({
    isLoading: false,
    data: [{ hardwareVariantId: 'v-3', code: 'treklink-v3', available: 10 }],
  }),
  approveContract: (...args: unknown[]) => approveContract(...args),
}));

// The public plans read (billing api-design 01) answers the variant names.
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (endpoint: string) =>
    endpoint === '/plans'
      ? Promise.resolve({ variants: [{ id: 'v-3', code: 'treklink-v3', name: 'TrekLink v3' }] })
      : new Promise(() => undefined),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ContractApprovalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('ContractApprovalPage', () => {
  afterEach(() => cleanup());

  it('names the variant by its display name in the queue and the request panel', async () => {
    renderPage();
    expect((await screen.findAllByText('TrekLink v3 x 5')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /RC-2026-0004/ })[0]);
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByText('5 x TrekLink v3')).toBeTruthy();
    expect(
      within(panel).getByText('10 TrekLink v3 available now; approval reserves 5.'),
    ).toBeTruthy();
    expect(within(panel).queryByText(/treklink-v3/)).toBeNull();
  });
});
