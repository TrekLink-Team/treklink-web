// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime, formatDay } from '../../shared/lib/format';
import { useToast } from '../../shared/ui/toastStore';
import { REVIEW_FORM_ID, ReviewMode } from './ReviewMode';

// Review mode of the contract home (chapter 06 §10.4, screen 5.3, rentals api-design 04, D-092).
// Only the API client is mocked: it answers the availability count and the approval. The sticky
// bar submits the form from outside; here the form is submitted directly. ContractDetailPage.test
// only checks that the page swaps the tab body for this view.
const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const FUTURE = '2099-01-01T02:00:00Z';
const PAST = '2020-01-01T02:00:00Z';

const contract = (extra: Partial<ContractDetail> = {}): ContractDetail =>
  ({
    id: 'c-1',
    code: 'RC-2026-0004',
    organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
    planType: 'MONTHLY',
    dayPlanDays: null,
    hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
    quantity: 5,
    requestedStartDate: '2026-11-30',
    monthlyUnitPriceVnd: 450_000,
    dayPremium: null,
    holdingFeeRatio: 0.5,
    holdExpiresAt: FUTURE,
    status: 'REQUESTED',
    version: 4,
    devices: [],
    ...extra,
  }) as unknown as ContractDetail;

const onPending = vi.fn();
const onDecided = vi.fn();
const onReload = vi.fn();
const show = (value: ContractDetail = contract()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ReviewMode
        contract={value}
        variantName="TrekLink v3"
        onPending={onPending}
        onDecided={onDecided}
        onReload={onReload}
      />
    </QueryClientProvider>,
  );

const fact = (label: string) => {
  const term = screen.getAllByRole('term').find((dt) => dt.textContent === label);
  return term?.nextElementSibling?.textContent ?? null;
};
const appointment = () => screen.getByLabelText('Handover appointment') as HTMLInputElement;
const approve = () => fireEvent.submit(document.getElementById(REVIEW_FORM_ID) as HTMLFormElement);
const availability = (available: number) => (url: string) =>
  url.startsWith('/devices/availability')
    ? Promise.resolve([{ hardwareVariantId: 'v-3', available }])
    : Promise.reject(new Error(`unexpected ${url}`));

beforeEach(() => {
  api.mockReset();
  onPending.mockReset();
  onDecided.mockReset();
  onReload.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('ReviewMode', () => {
  describe('the request', () => {
    it('lists the organization, plan, units, start and the prices fixed at request', () => {
      show();
      expect(screen.getByRole('region', { name: 'Review request' })).toBeTruthy();
      expect(fact('Organization')).toBe('ORG-0001, Acme Trek');
      expect(fact('Plan')).toBe('Monthly');
      expect(fact('Units')).toBe('5 x TrekLink v3');
      expect(fact('Requested start')).toBe(formatDay('2026-11-30'));
      expect(fact('Monthly price per device')).toBe('450,000 VND, fixed at request');
      expect(fact('Holding fee')).toBe('50 % of a term');
      expect(fact('Hold expires')).toBe(formatDateTime(FUTURE));
      expect(fact('Day premium')).toBeNull();
    });

    it('shows the day premium of a day plan, and no organization when the reader has none', () => {
      show(
        contract({
          planType: 'DAY',
          dayPlanDays: 3,
          dayPremium: 1.5,
          organization: null,
        } as unknown as Partial<ContractDetail>),
      );
      expect(fact('Plan')).toBe('Day plan, 3 days');
      expect(fact('Day premium')).toBe('x 1.5, fixed at request');
      expect(fact('Organization')).toBeNull();
    });
  });

  describe('units held or stock check (D-092)', () => {
    it('says the request holds its units while the hold is open, without counting stock', () => {
      show();
      expect(screen.getByRole('heading', { name: 'Units held' })).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(
        `This request holds its 5 TrekLink v3 units; approval keeps them. An unpaid hold ends ${formatDateTime(FUTURE)}.`,
      );
      expect(api).not.toHaveBeenCalled();
    });

    it('warns once the hold has ended', () => {
      show(contract({ holdExpiresAt: PAST }));
      expect(screen.getByRole('alert').textContent).toMatch(
        /^The hold of this request ended .+ If the deposit is unpaid, approval is refused/,
      );
    });

    it('counts stock for a request sent before D-092, with no hold', async () => {
      api.mockImplementation(availability(8));
      show(contract({ holdExpiresAt: null }));
      expect(screen.getByRole('heading', { name: 'Stock check' })).toBeTruthy();
      expect(screen.getByText('Checking availability…')).toBeTruthy();
      expect(
        await screen.findByText('8 TrekLink v3 available now; approval reserves 5.'),
      ).toBeTruthy();
      expect(api).toHaveBeenCalledWith('/devices/availability?hardwareVariantId=v-3');
    });

    it('warns when fewer units are available than requested', async () => {
      api.mockImplementation(availability(3));
      show(contract({ holdExpiresAt: null }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Only 3 TrekLink v3 available now.',
      );
    });

    it('leaves the count to approval when it cannot be read', async () => {
      api.mockRejectedValue(new Error('offline'));
      show(contract({ holdExpiresAt: null }));
      expect(await screen.findByText('Availability is unknown; approval checks it.')).toBeTruthy();
    });
  });

  describe('Approve request', () => {
    it('proposes 09:00 on the requested start day', () => {
      show();
      expect(appointment().value).toBe('2026-11-30T09:00');
      expect(appointment().type).toBe('datetime-local');
    });

    it('approves with the appointment and the version it saw, then reports the reserved units', async () => {
      const approved = { contract: { id: 'c-1' }, devices: [{}, {}, {}, {}, {}] };
      api.mockResolvedValue(approved);
      show();
      fireEvent.change(appointment(), { target: { value: '2026-12-01T10:30' } });
      approve();
      await waitFor(() => expect(onDecided).toHaveBeenCalledWith(approved));
      expect(api).toHaveBeenCalledWith('/contracts/c-1/approve', {
        method: 'POST',
        body: JSON.stringify({
          handoverAt: new Date('2026-12-01T10:30').toISOString(),
          expectedVersion: 4,
        }),
      });
      expect(onPending.mock.calls).toEqual([[true], [false]]);
      expect(useToast.getState().message).toBe('RC-2026-0004 approved. 5 devices reserved.');
    });

    it('needs an appointment, and the field error goes as soon as one is typed', () => {
      show();
      fireEvent.change(appointment(), { target: { value: '' } });
      approve();
      expect(screen.getByRole('alert').textContent).toBe('Handover appointment is required.');
      expect(appointment().getAttribute('aria-invalid')).toBe('true');
      expect(api).not.toHaveBeenCalled();
      expect(onPending).not.toHaveBeenCalled();
      fireEvent.change(appointment(), { target: { value: '2026-12-01T09:00' } });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('puts a validation refusal on the field', async () => {
      api.mockRejectedValue(
        new ApiError(400, 'VALIDATION_FAILED', 'The appointment must be in the future.'),
      );
      show();
      approve();
      expect((await screen.findByRole('alert')).textContent).toBe(
        'The appointment must be in the future.',
      );
      expect(screen.queryByText('The approval was refused')).toBeNull();
      expect(onDecided).not.toHaveBeenCalled();
      expect(onPending.mock.calls).toEqual([[true], [false]]);
    });

    it('offers Reload on a stale version', async () => {
      api.mockRejectedValue(new ApiError(409, 'STALE_VERSION', 'The contract changed.'));
      show();
      approve();
      const refused = within(document.getElementById(REVIEW_FORM_ID) as HTMLFormElement);
      expect(await refused.findByText('The approval was refused')).toBeTruthy();
      expect(refused.getByText('The contract changed.')).toBeTruthy();
      fireEvent.click(refused.getByRole('button', { name: 'Reload' }));
      expect(onReload).toHaveBeenCalledTimes(1);
      expect(onDecided).not.toHaveBeenCalled();
    });

    it('hands back to the page when the request already moved on', async () => {
      api.mockRejectedValue(
        new ApiError(409, 'INVALID_STATE_TRANSITION', 'The request is no longer open.'),
      );
      show();
      approve();
      await waitFor(() => expect(onDecided).toHaveBeenCalledWith(null));
      expect(screen.getByText('The request is no longer open.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    });

    it('shows a generic refusal when the failure is not an API error', async () => {
      api.mockRejectedValue(new TypeError('Failed to fetch'));
      show();
      approve();
      expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
      expect(screen.getByText('The approval was refused')).toBeTruthy();
    });
  });

  it('explains what Approve and Reject do', () => {
    show();
    expect(fact('Approve request')).toBe(
      'Keeps the held units reserved for the handover at the appointment above.',
    );
    expect(fact('Reject request, in More actions')).toMatch(/^Closes the request as Rejected/);
  });
});
