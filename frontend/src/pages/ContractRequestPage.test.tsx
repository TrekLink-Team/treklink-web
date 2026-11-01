// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../app/providers/useAuth';
import { ApiError } from '../shared/api/apiClient';
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
    Promise.resolve(
      endpoint === '/plans'
        ? PLANS
        : endpoint === '/devices/availability'
          ? []
          : { id: 'org-1', status },
    ),
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

// D-092 rule 1 (screen 5.1 amended 2026-11-01): the count of devices api-design 24 beside Quantity,
// MSG11 above it, and the hold expiry with the deposit after sending.
describe('ContractRequestPage availability and the hold at request', () => {
  const REQUESTED = {
    id: 'c-9',
    code: 'RC-2026-0009',
    planType: 'MONTHLY',
    quantity: 5,
    status: 'REQUESTED',
    holdExpiresAt: '2026-11-02T03:00:00.000Z',
    heldDevices: 5,
    quote: { firstPaymentVnd: 625000, termFeeVnd: 1250000 },
  };
  let available = 7;
  let onRequest: () => unknown = () => REQUESTED;

  const renderActive = () => {
    api.mockImplementation((endpoint: string) => {
      if (endpoint === '/plans') return Promise.resolve(PLANS);
      if (endpoint === '/devices/availability') {
        return Promise.resolve([{ hardwareVariantId: 'v-3', code: 'treklink-v3', available }]);
      }
      if (endpoint === '/quotes') {
        return Promise.resolve({
          planType: 'MONTHLY',
          firstPaymentVnd: 625000,
          termFeeVnd: 1250000,
          formula: '250000 x 5 x 0.5',
        });
      }
      if (endpoint === '/contracts') {
        try {
          return Promise.resolve(onRequest());
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return Promise.resolve({ id: 'org-1', status: 'ACTIVE' });
    });
    return render(
      <AuthContext.Provider value={{ user: MANAGER, signOut: vi.fn() }}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/o/contracts/new']}>
            <Routes>
              <Route path="/o/contracts/new" element={<ContractRequestPage />} />
              <Route path="/o/contracts/:id" element={<p>contract page</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );
  };

  const choose = async (quantity: string) => {
    const variant = await screen.findByLabelText('Hardware variant');
    await screen.findByRole('option', { name: /7 available now/ });
    fireEvent.change(variant, { target: { value: 'v-3' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: quantity } });
  };

  beforeEach(() => {
    available = 7;
    onRequest = () => REQUESTED;
  });

  it('shows the count per variant and beside Quantity, and refreshes it on request', async () => {
    renderActive();
    await choose('5');
    expect(await screen.findByText('7 available now')).toBeTruthy();
    const calls = () =>
      api.mock.calls.filter(([endpoint]) => endpoint === '/devices/availability').length;
    const before = calls();
    available = 4;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('4 available now')).toBeTruthy();
    expect(calls()).toBeGreaterThan(before);
  });

  it('refuses a quantity above the count with MSG11 and stays on step 1', async () => {
    renderActive();
    await choose('8');
    await screen.findByText('7 available now');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByText(
        'Only 7 V3 devices are available. Lower the quantity or choose another variant.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Plan and devices' })).toBeTruthy();
  });

  const sendRequest = async () => {
    renderActive();
    await choose('5');
    await screen.findByText('7 available now');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('Start date (handover day)'), {
      target: { value: '2099-01-05' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
  };

  it('after sending, shows the units held, the hold expiry and the deposit due', async () => {
    await sendRequest();
    expect(await screen.findByRole('heading', { name: 'Request RC-2026-0009 sent' })).toBeTruthy();
    const panel = screen.getByRole('status');
    expect(panel.textContent).toContain('5 V3 devices are held for you until');
    expect(panel.textContent).toContain('2026');
    expect(panel.textContent).toContain('Deposit due before then: 625,000 VND, the holding fee.');
    expect(screen.getByRole('link', { name: 'Open the contract' }).getAttribute('href')).toBe(
      '/o/contracts/c-9',
    );
    expect(screen.getByRole('link', { name: 'Pay the deposit' }).getAttribute('href')).toBe(
      '/o/invoices?contractId=c-9',
    );
  });

  it('puts a 409 INSUFFICIENT_DEVICES under Quantity on step 1 when another organization was first', async () => {
    onRequest = () => {
      throw new ApiError(
        409,
        'INSUFFICIENT_DEVICES',
        'Only 2 treklink-v3 devices are available. Lower the quantity or choose another variant.',
      );
    };
    await sendRequest();
    expect(
      await screen.findByText(
        'Only 2 treklink-v3 devices are available. Lower the quantity or choose another variant.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Plan and devices' })).toBeTruthy();
  });
});
