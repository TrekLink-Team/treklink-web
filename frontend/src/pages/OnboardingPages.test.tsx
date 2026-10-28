// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationReview } from '../entities/organization/api';
import { OrganizationReviewPage } from './OrganizationReviewPage';
import { RegisterPage } from './RegisterPage';

const registerOrganization = vi.fn();
const verifyOrganization = vi.fn();
let items: OrganizationReview[] = [];

vi.mock('../entities/organization/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/organization/api')>()),
  registerOrganization: (...args: unknown[]) => registerOrganization(...args),
  verifyOrganization: (...args: unknown[]) => verifyOrganization(...args),
  useOrganizations: () => ({ data: { items, totalCount: items.length }, isLoading: false }),
}));

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-admin', roles: ['ADMIN'] } }),
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
