// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricesPage } from './PricesPage';

const price = (id: string, state: 'CURRENT' | 'UPCOMING' | 'PAST', hardwareVariantId = 'v-3') => ({
  id,
  hardwareVariantId,
  monthlyPriceVnd: 350_000,
  effectiveFrom: '2026-11-01T00:00:00Z',
  state,
  createdBy: 'Demo Admin',
  createdAt: '2026-10-01T00:00:00Z',
});

const rate = (id: string, code: string, isActive: boolean) => ({
  id,
  code,
  label: `${code} label`,
  hardwareVariantId: null,
  amountVnd: 200_000,
  isActive,
});

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  usePlans: () => ({ data: { variants: [{ id: 'v-3', code: 'treklink-v3' }, { id: 'v-4', code: 'treklink-v4' }] } }),
  usePriceHistory: () => ({
    isLoading: false,
    data: {
      items: [price('p-1', 'CURRENT'), price('p-2', 'UPCOMING', 'v-4'), price('p-3', 'PAST')],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 3,
      totalPages: 1,
    },
  }),
  useDamageRates: () => ({
    isLoading: false,
    data: [rate('r-1', 'CASING_CRACKED', true), rate('r-2', 'ANTENNA_BENT', true), rate('r-3', 'SCREEN_DEAD', false)],
  }),
}));

afterEach(cleanup);

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PricesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('PricesPage on CollectionView (screen 6.4, D-096)', () => {
  it('filters the price history by state from Show and finds a variant by search', () => {
    renderPage();
    const prices = () => within(screen.getByRole('table', { name: 'Monthly price history' }));
    expect(prices().getAllByRole('row')).toHaveLength(4);
    const history = screen.getByRole('region', { name: 'Monthly price history' });
    fireEvent.click(within(history).getByRole('button', { name: /^Show: All states/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Upcoming' }));
    expect(prices().getAllByRole('row')).toHaveLength(2);
    expect(prices().getByText('treklink-v4')).toBeTruthy();
  });

  it('edits a damage rate from its item action and filters inactive ones', () => {
    renderPage();
    const rates = screen.getByRole('region', { name: 'Damage rates' });
    fireEvent.click(within(rates).getByRole('button', { name: /^Show: Active and inactive/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inactive' }));
    const table = within(screen.getByRole('table', { name: 'Damage rates' }));
    expect(table.getByText('SCREEN_DEAD')).toBeTruthy();
    expect(table.queryByText('CASING_CRACKED')).toBeNull();
    fireEvent.click(table.getByRole('button', { name: 'Edit SCREEN_DEAD' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
