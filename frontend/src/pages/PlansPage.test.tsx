// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plans } from '../entities/billing/api';
import { ApiError } from '../shared/api/apiClient';
import { SAR_DISCLAIMER } from '../shared/ui';
import { FOCUS } from '../shared/ui/styles';
import { PlansPage } from './PlansPage';

const fetchPlans = vi.fn();
let requestedOptions: unknown;
let signedIn: { id: string; roles: string[]; accountType: string; organization: null } | null =
  null;

vi.mock('../entities/billing/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../entities/billing/api')>();
  const { useQuery } = await import('@tanstack/react-query');
  return {
    ...original,
    usePlans: (options: unknown) => {
      requestedOptions = options;
      return useQuery({ queryKey: ['plans'], queryFn: () => fetchPlans(), retry: false });
    },
  };
});

vi.mock('../app/providers/useAuth', () => ({ useAuth: () => ({ user: signedIn }) }));

// The sandbox test accounts box has its own tests (widgets/TestAccountsBox); here demo mode is off.
vi.mock('../entities/demo/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/demo/api')>()),
  useDemoAccounts: () => ({ data: undefined }),
}));

const plans = (overrides: Partial<Plans> = {}): Plans => ({
  minOrderQuantity: 5,
  holdingFeeRatio: 0.5,
  dayPlanLengths: [3, 4, 7],
  dayPremium: 1.5,
  variants: [
    {
      id: 'v-1',
      code: 'treklink-v3',
      name: 'TrekLink v3 (GPS, SOS button)',
      monthlyPriceVnd: 450000,
      dayPriceVnd: 22500,
    },
  ],
  sandbox: true,
  ...overrides,
});

const renderPage = (client = new QueryClient()) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  fetchPlans.mockReset();
  requestedOptions = undefined;
  signedIn = null;
});

describe('PlansPage (screen 2.3)', () => {
  it('shows the disclaimer and the steps while the prices load', () => {
    fetchPlans.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading plans' })).toBeTruthy();
    expect(screen.getAllByText(SAR_DISCLAIMER)).toHaveLength(2);
    expect(screen.getByText('Register your organization.')).toBeTruthy();
  });

  it('renders the variant prices, the sandbox label and the shared terms', async () => {
    fetchPlans.mockResolvedValue(plans());
    renderPage();
    expect(await screen.findByText('TrekLink v3 (GPS, SOS button)')).toBeTruthy();
    expect(screen.getByText('treklink-v3')).toBeTruthy();
    expect(screen.getByText(/450,000 VND \/ device \/ month/)).toBeTruthy();
    expect(screen.getByText(/22,500 VND \/ device \/ day/)).toBeTruthy();
    expect(screen.getAllByText('Sandbox price')).toHaveLength(2);
    expect(screen.getByText('From 5 devices per contract.')).toBeTruthy();
    expect(screen.getByText(/Day plans of 3, 4 or 7 days, at 1.5 times/)).toBeTruthy();
    expect(screen.getByText(/holding fee of 50 % of the first monthly term/)).toBeTruthy();
  });

  it('keeps the prices fresh for five minutes and does not refetch on window focus', () => {
    fetchPlans.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(requestedOptions).toEqual({ staleTime: 300_000, refetchOnWindowFocus: false });
  });

  it('hides the sandbox label when the server says the prices are live', async () => {
    fetchPlans.mockResolvedValue(plans({ sandbox: false }));
    renderPage();
    await screen.findByText('TrekLink v3 (GPS, SOS button)');
    expect(screen.queryByText('Sandbox price')).toBeNull();
  });

  it('offers Register and Sign in to a visitor', async () => {
    fetchPlans.mockResolvedValue(plans());
    renderPage();
    await screen.findByText('TrekLink v3 (GPS, SOS button)');
    expect(screen.getAllByRole('link', { name: 'Register your organization' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
  });

  it('offers a signed-in user the workspace instead of Sign in and Register', async () => {
    signedIn = { id: 'u-1', roles: ['ORG_MANAGER'], accountType: 'ORGANIZATION', organization: null };
    fetchPlans.mockResolvedValue(plans());
    renderPage();
    await screen.findByText('TrekLink v3 (GPS, SOS button)');
    expect(screen.getByRole('link', { name: 'Open your workspace' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Register your organization' })).toBeNull();
  });

  it('says no plans are available and links to the contact details', async () => {
    fetchPlans.mockResolvedValue(plans({ variants: [] }));
    renderPage();
    expect(await screen.findByText('No plans are available right now.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact TrekLink' }).getAttribute('href')).toBe(
      '#contact',
    );
    expect(screen.getByRole('link', { name: 'treklink.team@gmail.com' }).getAttribute('href')).toBe(
      'mailto:treklink.team@gmail.com',
    );
    expect(screen.queryByText('Terms for every plan')).toBeNull();
  });

  it('shows the keyboard focus ring on the contact link (WCAG 2.4.7)', () => {
    fetchPlans.mockReturnValue(new Promise(() => undefined));
    renderPage();
    const contact = screen.getByRole('link', { name: 'treklink.team@gmail.com' });
    for (const focusClass of FOCUS.split(' ')) {
      expect(contact.classList.contains(focusClass)).toBe(true);
    }
  });

  it('shows the server message with Retry, and Retry loads the prices', async () => {
    fetchPlans.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Prices are unavailable.'));
    fetchPlans.mockResolvedValue(plans());
    renderPage();
    expect(await screen.findByText('Prices are unavailable.')).toBeTruthy();
    expect(screen.getAllByText(SAR_DISCLAIMER)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const heading = await screen.findByText('TrekLink v3 (GPS, SOS button)');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('returns focus after a Retry that loads the same prices again', async () => {
    fetchPlans.mockResolvedValueOnce(plans());
    fetchPlans.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Prices are unavailable.'));
    fetchPlans.mockResolvedValue(plans());
    const client = new QueryClient();
    renderPage(client);
    const heading = await screen.findByText('TrekLink v3 (GPS, SOS button)');
    // A background refetch fails: the prices stay with the error and Retry.
    await act(() => client.refetchQueries({ queryKey: ['plans'] }));
    expect(await screen.findByText('Prices are unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Prices are unavailable.')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('falls back to a plain message on a network failure', async () => {
    fetchPlans.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    expect(await screen.findByText('The prices could not be loaded.')).toBeTruthy();
  });
});
