// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloseCheck, ContractDetail } from '../../entities/contract/api';
import { formatDateTime, formatDay, formatVnd } from '../../shared/lib/format';
import { OverviewTab } from './OverviewTab';

// The Overview tab of the contract home (rentals api-design 03 and 20, D-092 rule 3). A pure view:
// everything comes in through props, so nothing is mocked; CloseBlockers runs for real.

const contract = (extra: Partial<ContractDetail> = {}): ContractDetail =>
  ({
    id: 'c-1',
    code: 'RC-2026-0004',
    organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
    planType: 'MONTHLY',
    dayPlanDays: null,
    hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
    quantity: 5,
    requestedStartDate: '2026-10-30',
    monthlyUnitPriceVnd: 450_000,
    dayPremium: null,
    holdingFeeRatio: 0.5,
    status: 'ACTIVE',
    statusChangedAt: '2026-10-30T02:00:00Z',
    handedOverAt: null,
    currentTerm: null,
    endsAt: null,
    noticeGivenAt: null,
    returnDueAt: null,
    handoverAppointmentAt: null,
    reservationExpiresAt: null,
    version: 2,
    terms: [],
    devices: [],
    balance: { dueNowVnd: 0, dueLaterVnd: 0 },
    ...extra,
  }) as ContractDetail;

const closeProps = (
  extra: Partial<NonNullable<React.ComponentProps<typeof OverviewTab>['close']>>,
) => ({
  check: undefined,
  loading: false,
  error: null,
  retry: vi.fn(),
  onClose: vi.fn(),
  onReportLost: vi.fn(),
  ...extra,
});

const show = (props: Partial<React.ComponentProps<typeof OverviewTab>> = {}) =>
  render(
    <MemoryRouter>
      <OverviewTab contract={contract()} scope="o" variantName="TrekLink v3" {...props} />
    </MemoryRouter>,
  );

const fact = (label: string) => {
  const term = screen.getAllByRole('term').find((dt) => dt.textContent === label);
  return term?.nextElementSibling?.textContent ?? null;
};

afterEach(cleanup);

describe('OverviewTab', () => {
  describe('Contract card', () => {
    it('shows the plan, the devices, the requested start and dates not yet reached', () => {
      show();
      expect(fact('Plan')).toBe('Monthly');
      expect(fact('Devices')).toBe('5 x TrekLink v3');
      expect(fact('Requested start')).toBe(formatDay('2026-10-30'));
      expect(fact('Handed over')).toBe('Not yet');
      expect(fact('Current term')).toBe('Not started');
    });

    it('names the organization to TrekLink only', () => {
      show({ scope: 't' });
      expect(fact('Organization')).toBe('ORG-0001, Acme Trek');
      cleanup();
      show({ scope: 'o' });
      expect(fact('Organization')).toBeNull();
    });

    it('labels a day plan with its length', () => {
      show({ contract: contract({ planType: 'DAY', dayPlanDays: 3 }) });
      expect(fact('Plan')).toBe('Day plan, 3 days');
    });

    it('shows each optional date only when it is set, as a time with its zone', () => {
      show({
        contract: contract({
          handoverAppointmentAt: '2026-10-30T09:00:00Z',
          handedOverAt: '2026-10-30T09:30:00Z',
          noticeGivenAt: '2026-11-10T02:00:00Z',
          returnDueAt: '2026-11-30T09:00:00Z',
        }),
      });
      expect(fact('Handover appointment')).toBe(formatDateTime('2026-10-30T09:00:00Z'));
      expect(fact('Handed over')).toBe(formatDateTime('2026-10-30T09:30:00Z'));
      expect(fact('Notice given')).toBe(formatDateTime('2026-11-10T02:00:00Z'));
      expect(fact('Return due')).toBe(formatDateTime('2026-11-30T09:00:00Z'));
      const time = screen.getAllByRole('time')[0] as HTMLTimeElement;
      expect(time.dateTime).toBe('2026-10-30T09:00:00Z');
      expect(time.title).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('hides the appointment, notice and return due when they are not set', () => {
      show();
      expect(fact('Handover appointment')).toBeNull();
      expect(fact('Notice given')).toBeNull();
      expect(fact('Return due')).toBeNull();
    });

    it.each([
      ['REQUESTED', 'Devices held until', 'holdExpiresAt'],
      ['APPROVED', 'Reservation expires', 'reservationExpiresAt'],
    ] as const)('shows the hold of a %s contract as "%s"', (status, label, field) => {
      show({ contract: contract({ status, [field]: '2026-10-31T09:00:00Z' }) });
      expect(fact(label)).toBe(formatDateTime('2026-10-31T09:00:00Z'));
    });

    it('does not show a hold or a reservation once the contract has moved on', () => {
      show({
        contract: contract({
          status: 'ACTIVE',
          holdExpiresAt: '2026-10-31T09:00:00Z',
          reservationExpiresAt: '2026-10-31T09:00:00Z',
        } as Partial<ContractDetail>),
      });
      expect(fact('Devices held until')).toBeNull();
      expect(fact('Reservation expires')).toBeNull();
    });

    it('describes the current term with its dates', () => {
      show({
        contract: contract({
          currentTerm: { seq: 2, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
        } as Partial<ContractDetail>),
      });
      expect(fact('Current term')).toMatch(/^Term 2, .+ to .+$/);
    });
  });

  describe('Terms card', () => {
    it('says no term is open before the handover', () => {
      show();
      expect(screen.getByText('No term is open yet.')).toBeTruthy();
    });

    it('lists the terms with their span and status', () => {
      show({
        contract: contract({
          terms: [
            {
              seq: 1,
              startsAt: '2026-10-01T00:00:00Z',
              endsAt: '2026-11-01T00:00:00Z',
              status: 'CLOSED',
            },
            {
              seq: 2,
              startsAt: '2026-11-01T00:00:00Z',
              endsAt: '2026-12-01T00:00:00Z',
              status: 'OPEN',
            },
          ],
        } as Partial<ContractDetail>),
      });
      const items = screen.getAllByRole('listitem').map((item) => item.textContent);
      expect(items).toEqual([
        `Term 1: ${formatDateTime('2026-10-01T00:00:00Z')} to ${formatDateTime('2026-11-01T00:00:00Z')}Closed`,
        `Term 2: ${formatDateTime('2026-11-01T00:00:00Z')} to ${formatDateTime('2026-12-01T00:00:00Z')}Open`,
      ]);
    });
  });

  describe('Prices fixed at request', () => {
    it('shows the monthly price and the holding fee as a whole percentage', () => {
      show({ contract: contract({ holdingFeeRatio: 0.333 }) });
      expect(fact('Monthly price per device')).toBe(formatVnd(450_000));
      expect(fact('Holding fee')).toBe('33 % of a term');
      expect(fact('Day premium')).toBeNull();
    });

    it('shows the day premium when the plan has one', () => {
      show({ contract: contract({ dayPremium: 1.5 }) });
      expect(fact('Day premium')).toBe('x 1.5');
    });
  });

  describe('Close panel (Staff, D-092 rule 3)', () => {
    it('is absent unless the page passes the close props', () => {
      show();
      expect(screen.queryByRole('heading', { name: 'Close' })).toBeNull();
    });

    it('offers Close contract when nothing blocks it', () => {
      const close = closeProps({
        check: { contractId: 'c-1', status: 'RETURNED', version: 3, canClose: true, blockers: [] },
      });
      show({ close });
      expect(screen.getByText('Nothing blocks the close.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close contract' }));
      expect(close.onClose).toHaveBeenCalledTimes(1);
    });

    it('lists the blockers instead, and passes Report lost through with the blocker', () => {
      const blocker = {
        code: 'DEVICE_OUT' as const,
        message: 'TL-0042 is not back.',
        deviceId: 'd-42',
        assetTag: 'TL-0042',
        lossCase: null,
      };
      const check: CloseCheck = {
        contractId: 'c-1',
        status: 'RETURN_DUE',
        version: 3,
        canClose: false,
        blockers: [blocker],
      };
      const close = closeProps({ check });
      show({ close });
      expect(screen.queryByRole('button', { name: 'Close contract' })).toBeNull();
      const blockers = screen.getByRole('region', { name: 'What still blocks the close' });
      fireEvent.click(within(blockers).getByRole('button', { name: 'Report TL-0042 lost' }));
      expect(close.onReportLost).toHaveBeenCalledWith(blocker);
    });

    it('shows a loading state, and a failed check with a retry', () => {
      const close = closeProps({ loading: true, error: new Error('Network down') });
      show({ close });
      expect(screen.getByRole('status')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(close.retry).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Close contract' })).toBeNull();
    });
  });
});
