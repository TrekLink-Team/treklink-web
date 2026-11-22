// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../app/providers/UnsavedChangesProvider';
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
    {
      id: 'v-3',
      code: 'treklink-v3',
      name: 'V3',
      imageUrl: null,
      specSheet: { mcu: 'ESP32', localAlarm: 'LED blinks' },
      monthlyPriceVnd: 250000,
      dayPriceVnd: 20000,
    },
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
    const variant = await screen.findByRole('radio', { name: 'V3' });
    await screen.findByText(/, 7 available$/);
    fireEvent.click(variant);
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: quantity } });
  };

  beforeEach(() => {
    available = 7;
    onRequest = () => REQUESTED;
  });

  it('below 768 px collapses the quote into a summary bar with the first payment that expands on tap (#465)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: !/min-width/.test(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      renderActive();
      await choose('5');
      const bar = await screen.findByRole('button', { name: /First payment 625,000 VND/ });
      expect(bar.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('complementary', { name: 'Quote' })).toBeNull();
      fireEvent.click(bar);
      expect(bar.getAttribute('aria-expanded')).toBe('true');
      const panel = screen.getByRole('complementary', { name: 'Quote' });
      expect(bar.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.textContent).toContain('Term fee (one month)');
      // One live region on a phone: the bar announces the new amount, the panel does not.
      expect(panel.hasAttribute('aria-live')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the whole quote beside the steps from 768 px', async () => {
    renderActive();
    await choose('5');
    const panel = await screen.findByRole('complementary', { name: 'Quote' });
    expect(panel.getAttribute('aria-live')).toBe('polite');
    expect(await screen.findByText('Term fee (one month)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /First payment/ })).toBeNull();
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

// treklink-web#536: the step is in the address, so browser Back and Forward move between steps, and
// browser Back past step 1 asks the same question as Cancel while something is entered.
describe('ContractRequestPage browser history', () => {
  const renderInRouter = (entries: string[]) => {
    api.mockImplementation((endpoint: string) =>
      Promise.resolve(
        endpoint === '/plans'
          ? PLANS
          : endpoint === '/devices/availability'
            ? [{ hardwareVariantId: 'v-3', code: 'treklink-v3', available: 9 }]
            : endpoint === '/quotes'
              ? { planType: 'MONTHLY', firstPaymentVnd: 1, termFeeVnd: 2, formula: 'f' }
              : { id: 'org-1', status: 'ACTIVE' },
      ),
    );
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <UnsavedChangesProvider canBlock={() => true}>
              <Routes>
                <Route path="/o/contracts/new" element={<ContractRequestPage />} />
                <Route path="/o/contracts" element={<p>contracts list</p>} />
              </Routes>
            </UnsavedChangesProvider>
          ),
        },
      ],
      { initialEntries: entries, initialIndex: entries.length - 1 },
    );
    render(
      <AuthContext.Provider value={{ user: MANAGER, signOut: vi.fn() }}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );
    return router;
  };
  const stepHeading = () => screen.getByRole('heading', { level: 2, name: /Plan and devices|Start date|Review and send/ });
  const fillStepOne = async () => {
    fireEvent.click(await screen.findByRole('radio', { name: 'V3' }));
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '6' } });
  };
  const browserBack = () => act(() => router.navigate(-1));
  let router: ReturnType<typeof renderInRouter>;

  it('pushes each step into the address and steps back with browser Back, keeping the values', async () => {
    router = renderInRouter(['/o/contracts', '/o/contracts/new']);
    await fillStepOne();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.state.location.search).toBe('?step=2');
    expect(stepHeading().textContent).toBe('Start date');
    fireEvent.change(screen.getByLabelText('Start date (handover day)'), {
      target: { value: '2999-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.state.location.search).toBe('?step=3');
    expect(stepHeading().textContent).toBe('Review and send');

    await browserBack();
    expect(stepHeading().textContent).toBe('Start date');
    expect((screen.getByLabelText('Start date (handover day)') as HTMLInputElement).value).toBe(
      '2999-01-01',
    );
    await browserBack();
    expect(router.state.location.search).toBe('');
    expect(stepHeading().textContent).toBe('Plan and devices');
    expect((screen.getByLabelText(/Quantity/) as HTMLInputElement).value).toBe('6');
    expect((screen.getByRole('radio', { name: 'V3' }) as HTMLInputElement).checked).toBe(true);

    await act(() => router.navigate(1));
    expect(stepHeading().textContent).toBe('Start date');
  });

  it('returns to the entry Next pushed when the in-page Back is used', async () => {
    router = renderInRouter(['/o/contracts', '/o/contracts/new']);
    await fillStepOne();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(stepHeading().textContent).toBe('Plan and devices');
    // No step entry was added: the next browser Back leaves the form (and asks first).
    await browserBack();
    expect(await screen.findByRole('dialog', { name: 'Discard this request?' })).toBeTruthy();
  });

  it('asks "Discard this request?" on browser Back from step 1 with something entered', async () => {
    router = renderInRouter(['/o/contracts', '/o/contracts/new']);
    await fillStepOne();
    await browserBack();
    const dialog = await screen.findByRole('dialog', { name: 'Discard this request?' });
    expect(dialog.textContent).toContain('What you entered is not saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/o/contracts/new');
    expect((screen.getByLabelText(/Quantity/) as HTMLInputElement).value).toBe('6');

    await browserBack();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('contracts list')).toBeTruthy();
  });

  it('leaves without a dialog on browser Back from a clean form', async () => {
    router = renderInRouter(['/o/contracts', '/o/contracts/new']);
    await screen.findByRole('radio', { name: 'V3' });
    await browserBack();
    expect(await screen.findByText('contracts list')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves through Cancel after one confirmation, with no second prompt from the guard', async () => {
    router = renderInRouter(['/o/contracts/new']);
    await fillStepOne();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('contracts list')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends a deep link to a later step back to the first unfilled step, and corrects the address', async () => {
    router = renderInRouter(['/o/contracts/new?step=3']);
    await screen.findByRole('radio', { name: 'V3' });
    expect(stepHeading().textContent).toBe('Plan and devices');
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });
});
