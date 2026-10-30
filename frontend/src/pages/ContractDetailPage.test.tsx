// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractDetailPage } from './ContractDetailPage';

let contract: Record<string, unknown>;
let variants: { id: string; code: string; name: string }[] | undefined;

const baseContract = {
  id: 'c-1',
  code: 'RC-2026-0004',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
  planType: 'MONTHLY',
  dayPlanDays: null,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  quantity: 5,
  requestedStartDate: '2026-10-30',
  monthlyUnitPriceVnd: 450_000,
  dayPremium: null,
  holdingFeeRatio: 0.5,
  status: 'APPROVED',
  statusChangedAt: '2026-10-30T02:00:00Z',
  handedOverAt: null,
  currentTerm: null,
  endsAt: null,
  noticeGivenAt: null,
  returnDueAt: null,
  handoverAppointmentAt: '2026-10-30T09:00:00Z',
  reservationExpiresAt: '2026-10-31T09:00:00Z',
  version: 2,
  terms: [],
  devices: [],
  balance: { dueNowVnd: 0, dueLaterVnd: 0 },
};

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { roles: ['STAFF'] } }),
}));

vi.mock('../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/contract/api')>()),
  useContract: () => ({ isLoading: false, isSuccess: true, data: contract }),
  useTransitions: () => ({ data: [] }),
}));

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useBalance: () => ({ data: undefined }),
}));

// The public plans read (billing api-design 01) answers the variant names; nothing else is fetched.
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (endpoint: string) =>
    endpoint === '/plans' && variants
      ? Promise.resolve({ variants })
      : new Promise(() => undefined),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/t/contracts/c-1']}>
        <Routes>
          <Route path="/t/contracts/:id" element={<ContractDetailPage scope="t" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('ContractDetailPage', () => {
  beforeEach(() => {
    contract = { ...baseContract };
    variants = [{ id: 'v-3', code: 'treklink-v3', name: 'TrekLink v3' }];
  });

  afterEach(() => cleanup());

  it('names the variant by the display name the request form shows', async () => {
    renderPage();
    expect(await screen.findByText('Monthly, 5 x TrekLink v3 for Acme Trek')).toBeTruthy();
    expect(screen.getByText('5 x TrekLink v3')).toBeTruthy();
    expect(screen.queryByText(/treklink-v3/)).toBeNull();
  });

  it('falls back to the variant code until the plans read answers', () => {
    variants = undefined;
    renderPage();
    expect(screen.getByText('5 x treklink-v3')).toBeTruthy();
  });
});
