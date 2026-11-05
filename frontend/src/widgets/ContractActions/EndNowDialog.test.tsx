// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail, EndPreview } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { useToast } from '../../shared/ui/toastStore';
import { EndNowDialog } from './EndNowDialog';
import { creditText, owedText } from './endNowText';

// End contract now (screen 5.2, rentals api-design 30 and 31, D-097).
const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const contract = {
  id: 'c-2',
  code: 'RC-2026-0002',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'TrekLink Demo Tours Co., Ltd.' },
  planType: 'MONTHLY',
  status: 'ACTIVE',
  version: 4,
} as unknown as ContractDetail;

const PREVIEW: EndPreview = {
  contractId: 'c-2',
  code: 'RC-2026-0002',
  planType: 'MONTHLY',
  endsAt: '2026-11-06T03:00:00.000Z',
  term: { seq: 2, startsAt: '2026-11-01T02:00:00.000Z', endsAt: '2026-12-01T02:00:00.000Z' },
  termFeeVnd: 900_000,
  termDays: 30,
  usedDays: 6,
  unusedDays: 24,
  creditVnd: 720_000,
  outstandingVnd: 0,
  owedToOrganizationVnd: 720_000,
};

const close = vi.fn();
const open = (viewer: 'staff' | 'manager' = 'staff') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EndNowDialog contract={contract} viewer={viewer} onClose={close} />
    </QueryClientProvider>,
  );
const endButton = () => screen.getByRole('button', { name: 'End contract now' });
const typeReason = (value: string) =>
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value } });

beforeEach(() => {
  api.mockReset();
  close.mockReset();
  api.mockImplementation((endpoint: string) =>
    endpoint.endsWith('/end-preview') ? Promise.resolve(PREVIEW) : Promise.resolve({}),
  );
});
afterEach(cleanup);

describe('End contract now dialog', () => {
  it('names the contract, the end time, the credit and the consequence, with focus on the safe choice', async () => {
    open('manager');
    const dialog = screen.getByRole('alertdialog', { name: 'End RC-2026-0002 now?' });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep the contract running' }),
    );
    expect(await within(dialog).findByText(/24 unused days of term 2 \(30 days\)/)).toBeTruthy();
    expect(within(dialog).getByText(/^Now, /)).toBeTruthy();
    expect(within(dialog).getByText(/TrekLink then owes your organization/)).toBeTruthy();
    expect(within(dialog).getByText(/becomes Return due at once/)).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/contracts/c-2/end-preview');
  });

  it('keeps End contract now disabled until the preview answers, and names a failed preview', async () => {
    api.mockImplementation(() =>
      Promise.reject(
        new ApiError(
          409,
          'INVALID_STATE_TRANSITION',
          'This cannot be done while it is RETURN_DUE.',
        ),
      ),
    );
    open();
    expect((endButton() as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText('This cannot be done while it is RETURN_DUE.')).toBeTruthy();
    expect((endButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for a reason, then ends the contract with the trimmed reason and the version', async () => {
    open();
    await screen.findByText(/24 unused days/);
    fireEvent.click(endButton());
    expect(await screen.findByText('Enter why the contract ends now.')).toBeTruthy();
    expect(api).not.toHaveBeenCalledWith('/contracts/c-2/end', expect.anything());

    typeReason('  Trek finished early  ');
    fireEvent.click(endButton());
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/contracts/c-2/end', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Trek finished early', expectedVersion: 4 }),
    });
    expect(useToast.getState().message).toBe('Contract ended. Check the units in at the counter.');
  });

  it('offers Reload on a stale version and keeps the dialog open', async () => {
    api.mockImplementation((endpoint: string) =>
      endpoint.endsWith('/end-preview')
        ? Promise.resolve(PREVIEW)
        : Promise.reject(
            new ApiError(
              409,
              'STALE_VERSION',
              'Someone else changed this. Reload to see the latest.',
            ),
          ),
    );
    open();
    await screen.findByText(/24 unused days/);
    typeReason('Done');
    fireEvent.click(endButton());
    expect(
      await screen.findByText('Someone else changed this. Reload to see the latest.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('words the credit and the amount owed from the preview only', () => {
    expect(creditText({ ...PREVIEW, planType: 'DAY', creditVnd: 0 })).toBe(
      'No credit: a day plan is already billed per day.',
    );
    expect(creditText({ ...PREVIEW, creditVnd: 0, unusedDays: 0 })).toBe(
      'No credit: the current term is used to its last day.',
    );
    expect(owedText(PREVIEW, 'staff', 'Acme Trek')).toMatch(
      /^TrekLink then owes Acme Trek .*refunded outside TrekLink\.$/,
    );
    expect(
      owedText({ ...PREVIEW, owedToOrganizationVnd: 0, outstandingVnd: 180_000 }, 'manager', 'x'),
    ).toMatch(/is still to pay before the contract closes\.$/);
    expect(owedText({ ...PREVIEW, owedToOrganizationVnd: 0 }, 'manager', 'x')).toBe(
      'Nothing is left to pay.',
    );
  });
});
