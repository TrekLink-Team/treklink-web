// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceCredit } from '../../entities/billing/api';
import { ServiceCreditsCard } from './ServiceCreditsCard';

const credit = (id: string, assetTag: string, overrides: Partial<ServiceCredit> = {}): ServiceCredit => ({
  id,
  contractId: 'c-1',
  contractDeviceId: `cd-${id}`,
  deviceId: `d-${id}`,
  assetTag,
  cause: 'BATTERY_FAULT',
  faultInspectionId: 'fi-1',
  outageFrom: '2026-10-20T02:00:00Z',
  outageSourceIncidentId: null,
  outageSourceNote: null,
  outageTo: '2026-10-22T02:00:00Z',
  outageDays: 2,
  computedVnd: 23_000,
  decidedVnd: null,
  appliedVnd: 0,
  status: 'REQUESTED',
  requestedById: 'u-1',
  decisionReason: null,
  decidedAt: null,
  refundReference: null,
  refundedAt: null,
  version: 1,
  createdAt: '2026-10-22T03:00:00Z',
  ...overrides,
});

let items: ServiceCredit[] = [];
vi.mock('../../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/billing/api')>()),
  useContractServiceCredits: () => ({ isLoading: false, error: null, data: { items } }),
}));

afterEach(() => {
  cleanup();
  items = [];
});

const renderCard = () =>
  render(
    <MemoryRouter>
      <ServiceCreditsCard contractId="c-1" />
    </MemoryRouter>,
  );

describe('ServiceCreditsCard on CollectionView (screen 6.5, D-096)', () => {
  it('lists the credits of the contract and narrows them by status from Show', () => {
    items = [
      credit('1', 'TL-0001'),
      credit('2', 'TL-0002', { status: 'REJECTED', decisionReason: 'Damage by the customer' }),
      credit('3', 'TL-0003', { status: 'APPLIED', decidedVnd: 20_000 }),
    ];
    renderCard();
    const table = () => within(screen.getByRole('table', { name: 'Service credits of this contract' }));
    expect(table().getAllByRole('row')).toHaveLength(4);
    expect(table().getByText('Damage by the customer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Show: All statuses/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rejected' }));
    expect(table().getAllByRole('row')).toHaveLength(2);
    expect(table().getByText('TL-0002')).toBeTruthy();
  });

  it('says so when the contract has no credit', () => {
    renderCard();
    expect(screen.getByText('No service credits on this contract.')).toBeTruthy();
  });
});
