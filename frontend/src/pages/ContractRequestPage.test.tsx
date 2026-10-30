// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../app/providers/useAuth';
import type { SessionUser } from '../entities/session/model';
import { ContractRequestPage } from './ContractRequestPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

// Signed in while the organization was still PENDING.
const MANAGER = {
  id: 'u-m',
  fullName: 'Manager',
  accountType: 'ORGANIZATION',
  roles: ['ORG_MANAGER'],
  organization: {
    id: 'org-1',
    code: 'ORG-0002',
    legalName: 'Org',
    status: 'PENDING',
    memberRole: 'MANAGER',
  },
} as SessionUser;

const PLANS = {
  minOrderQuantity: 5,
  holdingFeeRatio: 0.5,
  dayPlanLengths: [3, 7],
  dayPremium: 0.2,
  variants: [
    { id: 'v-3', code: 'treklink-v3', name: 'V3', monthlyPriceVnd: 250000, dayPriceVnd: 20000 },
  ],
  sandbox: true,
};

const renderWith = (status: string) => {
  api.mockImplementation((endpoint: string) =>
    Promise.resolve(endpoint === '/plans' ? PLANS : { id: 'org-1', status }),
  );
  return render(
    <AuthContext.Provider value={{ user: MANAGER, signOut: vi.fn() }}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/o/contracts/new']}>
          <Routes>
            <Route path="/o/contracts/new" element={<ContractRequestPage />} />
            <Route path="/o/contracts" element={<p>contracts list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
};

beforeEach(() => api.mockReset());
afterEach(cleanup);

describe('ContractRequestPage organization status (screen 5.1)', () => {
  it('reads the status from the API, so an approval since sign-in enables the request', async () => {
    renderWith('ACTIVE');
    await waitFor(() => expect(api).toHaveBeenCalledWith('/organizations/org-1'));
    await waitFor(() => expect(screen.queryByText(/This cannot be done while it is/)).toBeNull());
    expect(screen.queryByText(/PENDING/)).toBeNull();
  });

  it('warns while the API still reports the organization as not active', async () => {
    renderWith('SUSPENDED');
    expect(await screen.findByText('This cannot be done while it is SUSPENDED.')).toBeTruthy();
  });
});

describe('ContractRequestPage discard prompt', () => {
  it('leaves at once when nothing was entered', async () => {
    renderWith('ACTIVE');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('contracts list')).toBeTruthy();
  });

  it('asks in a dialog once something was entered, and stays on Keep editing', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderWith('ACTIVE');
    fireEvent.change(await screen.findByLabelText(/Quantity/), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('dialog', { name: 'Discard this request?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('contracts list')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Back to contracts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('contracts list')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
