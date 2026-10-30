// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationReview, OrganizationTransition } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { OrganizationReviewPage } from './OrganizationReviewPage';
import { RegisterPage } from './RegisterPage';

const registerOrganization = vi.fn();
const verifyOrganization = vi.fn();
const suspendOrganization = vi.fn();
const reactivateOrganization = vi.fn();
const closeOrganization = vi.fn();
let items: OrganizationReview[] = [];
let transitions: OrganizationTransition[] = [];
let roles = ['ADMIN'];

vi.mock('../entities/organization/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/organization/api')>()),
  registerOrganization: (...args: unknown[]) => registerOrganization(...args),
  verifyOrganization: (...args: unknown[]) => verifyOrganization(...args),
  suspendOrganization: (...args: unknown[]) => suspendOrganization(...args),
  reactivateOrganization: (...args: unknown[]) => reactivateOrganization(...args),
  closeOrganization: (...args: unknown[]) => closeOrganization(...args),
  useOrganizations: () => ({ data: { items, totalCount: items.length }, isLoading: false }),
  useOrganizationTransitions: () => ({ data: transitions, isLoading: false }),
}));

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-admin', roles } }),
}));

const organization = (overrides: Partial<OrganizationReview> = {}): OrganizationReview => ({
  id: 'org-2',
  code: 'ORG-0002',
  legalName: 'Lang Biang Trekking Co., Ltd.',
  taxCode: '0312345678',
  address: '1 Le Loi, Da Lat',
  contactEmail: 'manager@example.com',
  contactPhone: '0901234567',
  status: 'PENDING',
  statusChangedAt: '2026-10-28T03:00:00Z',
  verifiedAt: null,
  verificationMethod: null,
  documentsSeen: [],
  masterContractRef: null,
  ndaSigned: false,
  softwareLicenceSigned: false,
  decidedAt: null,
  rejectionReason: null,
  version: 0,
  createdAt: '2026-10-28T03:00:00Z',
  ...overrides,
});

const renderPage = (page: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  registerOrganization.mockReset();
  verifyOrganization.mockReset();
  suspendOrganization.mockReset();
  reactivateOrganization.mockReset();
  closeOrganization.mockReset();
  transitions = [];
  roles = ['ADMIN'];
});

describe('RegisterPage (screen 3.1)', () => {
  it('names every empty field and sends nothing', () => {
    renderPage(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(screen.getByText('Tax code is required.')).toBeTruthy();
    expect(screen.getByText('Manager email is required.')).toBeTruthy();
    expect(registerOrganization).not.toHaveBeenCalled();
  });

  it('shows MSG04 with the new organization code', async () => {
    registerOrganization.mockResolvedValue({ code: 'ORG-0002' });
    renderPage(<RegisterPage />);
    const values: Record<string, string> = {
      'Registered company name': 'Lang Biang Trekking Co., Ltd.',
      'Tax code': '0312345678',
      'Registered address': '1 Le Loi, Da Lat',
      'Company phone': '0901234567',
      'Manager full name': 'Demo Manager',
      'Manager email': ' manager@example.com ',
      'Manager phone': '0907654321',
    };
    for (const [label, value] of Object.entries(values)) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(screen.getByText('ORG-0002')).toBeTruthy());
    expect(
      screen.getByText(
        /^Registration received. Visit the TrekLink counter or call us to verify your organization.$/,
      ),
    ).toBeTruthy();
    expect(registerOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ managerEmail: 'manager@example.com' }),
    );
  });
});

describe('RegisterPage duplicates (screen 3.1, MSG10)', () => {
  it("shows the server's MSG10 for a tax code already registered and keeps the form", async () => {
    registerOrganization.mockRejectedValue(
      new ApiError(409, 'CONFLICT_UNIQUE', '0312345678 is already registered.'),
    );
    renderPage(<RegisterPage />);
    const values: Record<string, string> = {
      'Registered company name': 'Lang Biang Trekking Co., Ltd.',
      'Tax code': '0312345678',
      'Registered address': '1 Le Loi, Da Lat',
      'Company phone': '0901234567',
      'Manager full name': 'Demo Manager',
      'Manager email': 'manager@example.com',
      'Manager phone': '0907654321',
    };
    for (const [label, value] of Object.entries(values)) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() =>
      expect(screen.getByText('0312345678 is already registered.')).toBeTruthy(),
    );
    expect((screen.getByLabelText(/^Tax code/) as HTMLInputElement).value).toBe('0312345678');
    expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
  });
});

describe('OrganizationReviewPage (screen 3.2)', () => {
  it('holds Approve until the organization is verified (MSG21)', () => {
    items = [organization()];
    renderPage(<OrganizationReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ORG-0002' }));
    expect(
      screen.getByText('Verify this organization at the counter before approving it.'),
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('refuses a verification without both contract terms and sends nothing', () => {
    items = [organization()];
    renderPage(<OrganizationReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ORG-0002' }));
    fireEvent.click(screen.getByLabelText('Business registration'));
    fireEvent.change(screen.getByLabelText(/^Master contract number/), {
      target: { value: 'MC-2026-0002' },
    });
    fireEvent.click(screen.getByLabelText('The master contract includes the signed NDA'));
    fireEvent.click(screen.getByRole('button', { name: 'Record verification' }));
    expect(
      screen.getByText('The master contract must include the signed NDA and the software licence.'),
    ).toBeTruthy();
    expect(verifyOrganization).not.toHaveBeenCalled();
  });

  it('keeps a phone verification as by phone when it is updated (review of #106)', async () => {
    verifyOrganization.mockResolvedValue({});
    items = [
      organization({
        verifiedAt: '2026-10-28T04:00:00Z',
        verificationMethod: 'PHONE',
        documentsSeen: ['Business registration'],
        masterContractRef: 'MC-2026-0002',
        ndaSigned: true,
        softwareLicenceSigned: true,
      }),
    ];
    renderPage(<OrganizationReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ORG-0002' }));
    expect((screen.getByLabelText('By phone') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Update verification' }));
    await waitFor(() => expect(verifyOrganization).toHaveBeenCalled());
    expect(verifyOrganization).toHaveBeenCalledWith(
      'org-2',
      expect.objectContaining({ method: 'PHONE', masterContractRef: 'MC-2026-0002' }),
    );
  });

  it('offers Approve on a verified organization', () => {
    items = [
      organization({
        verifiedAt: '2026-10-28T04:00:00Z',
        verificationMethod: 'IN_PERSON',
        masterContractRef: 'MC-2026-0002',
        ndaSigned: true,
        softwareLicenceSigned: true,
      }),
    ];
    renderPage(<OrganizationReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ORG-0002' }));
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('OrganizationReviewPage status actions (screen 3.2, organizations api-design 08 to 11)', () => {
  const active = (overrides: Partial<OrganizationReview> = {}) =>
    organization({ status: 'ACTIVE', verifiedAt: '2026-10-28T04:00:00Z', version: 3, ...overrides });

  const open = () => fireEvent.click(screen.getByRole('button', { name: 'ORG-0002' }));

  it('suspends an active organization with the reason shown to the Manager', async () => {
    suspendOrganization.mockResolvedValue({});
    items = [active()];
    renderPage(<OrganizationReviewPage />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend organization' }));
    expect(screen.getByText('Reason is required.')).toBeTruthy();
    expect(suspendOrganization).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Reason shown to the Manager/), {
      target: { value: '  Unpaid balance  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend organization' }));
    await waitFor(() =>
      expect(suspendOrganization).toHaveBeenCalledWith('org-2', 'Unpaid balance', 3),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the close dialog open with OPEN_CONTRACTS from the server', async () => {
    closeOrganization.mockRejectedValue(
      new ApiError(409, 'OPEN_CONTRACTS', 'This cannot be done while it has open contracts.'),
    );
    items = [active()];
    renderPage(<OrganizationReviewPage />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close organization' }));
    fireEvent.change(screen.getByLabelText(/^Reason shown to the Manager/), {
      target: { value: 'Stopped trading' },
    });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Close organization',
      )!,
    );
    await waitFor(() =>
      expect(screen.getByText('This cannot be done while it has open contracts.')).toBeTruthy(),
    );
    expect(closeOrganization).toHaveBeenCalledWith('org-2', 'Stopped trading', 3);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps the suspend dialog open with STALE_VERSION and refetches the queue (review of #156)', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    suspendOrganization.mockRejectedValue(
      new ApiError(409, 'STALE_VERSION', 'This was changed by someone else. Reload and try again.'),
    );
    items = [active()];
    renderPage(<OrganizationReviewPage />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    fireEvent.change(screen.getByLabelText(/^Reason shown to the Manager/), {
      target: { value: 'Unpaid balance' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend organization' }));

    await waitFor(() =>
      expect(
        screen.getByText('This was changed by someone else. Reload and try again.'),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['organizations'] });
    invalidate.mockRestore();
  });

  it('reactivates a suspended organization, and shows BALANCE_OUTSTANDING when refused', async () => {
    reactivateOrganization.mockRejectedValueOnce(
      new ApiError(409, 'BALANCE_OUTSTANDING', 'This cannot be done while it has open balances.'),
    );
    reactivateOrganization.mockResolvedValueOnce({});
    items = [active({ status: 'SUSPENDED', version: 4 })];
    renderPage(<OrganizationReviewPage />);
    open();
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() =>
      expect(screen.getByText('This cannot be done while it has open balances.')).toBeTruthy(),
    );
    expect(reactivateOrganization).toHaveBeenCalledWith('org-2', 4);

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(reactivateOrganization).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('This cannot be done while it has open balances.')).toBeNull(),
    );
  });

  it('shows the status history to Staff, without the Admin actions', () => {
    roles = ['STAFF'];
    transitions = [
      {
        fromStatus: 'PENDING',
        toStatus: 'ACTIVE',
        actor: 'Demo Admin',
        reason: null,
        createdAt: '2026-10-28T05:00:00Z',
      },
      {
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        actor: 'SYSTEM',
        reason: 'Contract RC-2026-0042 defaulted',
        createdAt: '2026-10-29T05:00:00Z',
      },
    ];
    items = [active({ status: 'SUSPENDED' })];
    renderPage(<OrganizationReviewPage />);
    open();
    expect(screen.getByText('Status history')).toBeTruthy();
    expect(screen.getByText('Pending to Active')).toBeTruthy();
    expect(screen.getByText(/SYSTEM: Contract RC-2026-0042 defaulted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull();
  });
});
