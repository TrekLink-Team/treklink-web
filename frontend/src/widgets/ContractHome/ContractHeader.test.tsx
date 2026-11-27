// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail, ContractTransition } from '../../entities/contract/api';
import { formatDate, formatDateTime } from '../../shared/lib/format';
import { PageChromeProvider } from '../../shared/ui/PageChrome';
import { ContractHeader, LifecycleCard } from './ContractHeader';

// The compact header and the lifecycle card of the contract home (chapter 06 §10.4 and §10.5,
// D-096, D-097). Only useMediaQuery is mocked, to pick the layout of the lifecycle card;
// lifecycleOf, deadlineOf and nextStepOf run for real (their own rules are in lifecycle.test.ts and
// policy.test.ts). This file covers what the two components draw from them.
const media = { wide: true };
vi.mock('../../shared/lib/useMediaQuery', () => ({ useMediaQuery: () => media.wide }));

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
    status: 'ACTIVE',
    statusChangedAt: '2026-10-30T02:00:00Z',
    handedOverAt: '2026-10-30T02:00:00Z',
    holdExpiresAt: null,
    currentTerm: null,
    endsAt: null,
    noticeGivenAt: null,
    returnDueAt: null,
    handoverAppointmentAt: null,
    reservationExpiresAt: null,
    version: 2,
    terms: [],
    devices: [],
    ...extra,
  }) as unknown as ContractDetail;

const short = (iso: string) => formatDate(iso).replace(/ \d{4}$/, '');
const step = (
  fromStatus: ContractTransition['fromStatus'],
  toStatus: ContractTransition['toStatus'],
  createdAt: string,
): ContractTransition => ({ fromStatus, toStatus, actor: null, reason: null, createdAt });
const HISTORY = [
  step(null, 'REQUESTED', '2026-10-28T02:00:00Z'),
  step('REQUESTED', 'APPROVED', '2026-10-29T02:00:00Z'),
  step('APPROVED', 'ACTIVE', '2026-10-30T02:00:00Z'),
];

const header = (props: Partial<React.ComponentProps<typeof ContractHeader>> = {}) =>
  render(<ContractHeader contract={contract()} scope="o" variantName="TrekLink v3" {...props} />);
const card = (props: Partial<React.ComponentProps<typeof LifecycleCard>> = {}) =>
  render(<LifecycleCard contract={contract()} history={HISTORY} viewer="staff" {...props} />);
const steps = () =>
  within(screen.getByRole('list', { name: 'Lifecycle steps' })).getAllByRole('listitem');
// The step's own words, with the state a screen reader hears before them.
const label = (item: HTMLElement) => item.children[1]?.textContent;
const nextStep = () =>
  screen.getByText('Next step').parentElement?.textContent?.replace('Next step', '') ?? '';

beforeEach(() => {
  media.wide = true;
});
afterEach(cleanup);

describe('ContractHeader', () => {
  it('shows the code as the page title, the status, the plan and the units', () => {
    header();
    expect(screen.getByRole('heading', { level: 1, name: 'RC-2026-0004' })).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Monthly · 5 x TrekLink v3')).toBeTruthy();
  });

  it('names the organization to TrekLink only', () => {
    header({ scope: 't' });
    expect(screen.getByText('Acme Trek ·')).toBeTruthy();
    cleanup();
    header({ scope: 'o' });
    expect(screen.queryByText(/Acme Trek/)).toBeNull();
  });

  it('labels a day plan with its length', () => {
    header({ contract: contract({ planType: 'DAY', dayPlanDays: 3 }) });
    expect(screen.getByText('Day plan, 3 days · 5 x TrekLink v3')).toBeTruthy();
  });

  it('shows the deadline that matters now as a time in the viewer zone', () => {
    header({
      contract: contract({
        currentTerm: { seq: 2, startsAt: '2026-11-30T02:00:00Z', endsAt: '2026-12-30T02:00:00Z' },
      } as Partial<ContractDetail>),
    });
    expect(screen.getByText('Term 2 ends')).toBeTruthy();
    const time = screen.getByRole('time') as HTMLTimeElement;
    expect(time.dateTime).toBe('2026-12-30T02:00:00Z');
    expect(time.textContent).toBe(formatDateTime('2026-12-30T02:00:00Z'));
    expect(time.title).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('shows the hold of a request as its deadline', () => {
    header({ contract: contract({ status: 'REQUESTED', holdExpiresAt: '2026-10-29T09:00:00Z' }) });
    expect(screen.getByText('Requested')).toBeTruthy();
    expect(screen.getByText('Hold expires')).toBeTruthy();
  });

  it('shows no deadline when none is due', () => {
    header({ contract: contract({ status: 'REQUESTED', holdExpiresAt: null }) });
    expect(screen.queryByRole('time')).toBeNull();
  });

  it('renders the shell breadcrumb with the title and claims it when it scrolls away', () => {
    const claim = vi.fn(() => () => undefined);
    render(
      <PageChromeProvider
        value={{ breadcrumb: <nav aria-label="Breadcrumb">Contracts</nav>, claim }}
      >
        <ContractHeader contract={contract()} scope="o" variantName="TrekLink v3" pinned={false} />
      </PageChromeProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'RC-2026-0004' })).toBeTruthy();
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('LifecycleCard', () => {
  describe('from 600 px', () => {
    it('lists the monthly path with each step marked done, current or not yet', () => {
      card();
      const items = steps();
      expect(items).toHaveLength(7);
      expect(label(items[0])).toBe('Completed: Requested');
      expect(within(items[0]).getByText(short('2026-10-28T02:00:00Z'))).toBeTruthy();
      expect(label(items[1])).toBe('Completed: Approved');
      expect(label(items[2])).toBe('Current: Active');
      expect(within(items[2]).getByText(`since ${short('2026-10-30T02:00:00Z')}`)).toBeTruthy();
      expect(label(items[3])).toBe('Not yet: Ending');
      expect(label(items[6])).toBe('Not yet: Closed');
    });

    it('marks only the current step with aria-current and numbers the steps not done', () => {
      card();
      const items = steps();
      expect(items.filter((item) => item.getAttribute('aria-current') === 'step')).toEqual([
        items[2],
      ]);
      expect(items[2].firstElementChild?.textContent).toBe('3');
      expect(items[3].firstElementChild?.textContent).toBe('4');
      expect(items[0].firstElementChild?.textContent).toBe('');
    });

    it('draws the shorter day path', () => {
      card({ contract: contract({ planType: 'DAY', dayPlanDays: 3 }) });
      expect(steps()).toHaveLength(6);
      expect(screen.queryByText(/Ending/)).toBeNull();
    });

    it('shows a cancellation as an exit on the step it left, and the rest as not reached', () => {
      card({
        contract: contract({
          status: 'CANCELLED',
          statusChangedAt: '2026-10-31T02:00:00Z',
          handedOverAt: null,
        }),
        history: [
          step(null, 'REQUESTED', '2026-10-28T02:00:00Z'),
          step('REQUESTED', 'APPROVED', '2026-10-29T02:00:00Z'),
          step('APPROVED', 'CANCELLED', '2026-10-31T02:00:00Z'),
        ],
      });
      const items = steps();
      expect(within(items[1]).getByText('Left the path here:')).toBeTruthy();
      expect(within(items[1]).getByText('Cancelled')).toBeTruthy();
      expect(within(items[1]).getByText(`since ${short('2026-10-31T02:00:00Z')}`)).toBeTruthy();
      expect(label(items[2])).toBe('Not reached: Active');
      expect(within(items[2]).getByText('not reached')).toBeTruthy();
      expect(nextStep()).toBe('No oneNo further steps.');
    });

    it('shows Ending as not reached after End contract now (D-097)', () => {
      card({
        contract: contract({ status: 'RETURN_DUE', statusChangedAt: '2026-11-15T02:00:00Z' }),
      });
      const items = steps();
      expect(label(items[3])).toBe('Not reached: Ending');
      expect(label(items[4])).toBe('Current: Return due');
    });

    it('shows the overdue detour on the Return due step', () => {
      card({
        contract: contract({ status: 'OVERDUE', statusChangedAt: '2026-12-02T02:00:00Z' }),
      });
      const returnDue = steps()[4];
      expect(within(returnDue).getByText('Overdue')).toBeTruthy();
      expect(within(returnDue).getByText(`since ${short('2026-12-02T02:00:00Z')}`)).toBeTruthy();
      expect(label(returnDue)).toBe('Completed: Return due');
    });
  });

  describe('Next step', () => {
    it('tells Staff that the organization gives notice on an active monthly contract', () => {
      card();
      expect(nextStep()).toBe(
        'Organization ManagerGive notice to end the contract when the current term ends.',
      );
    });

    it('addresses the Organization Manager as You', () => {
      card({ viewer: 'manager' });
      expect(nextStep()).toMatch(/^YouGive notice/);
    });

    it('gives a request to Staff to review, with the hold', () => {
      card({
        contract: contract({
          status: 'REQUESTED',
          handedOverAt: null,
          holdExpiresAt: '2026-10-29T09:00:00Z',
        }),
        history: [],
      });
      expect(nextStep()).toBe(
        `TrekLink StaffReview the request before the hold expires on ${formatDateTime('2026-10-29T09:00:00Z')}.`,
      );
    });
  });

  describe('below 600 px', () => {
    beforeEach(() => {
      media.wide = false;
    });

    it('collapses to one line that names the step, and keeps the full list in the disclosure', () => {
      card();
      const summary = document.querySelector('summary');
      expect(summary?.textContent).toBe(
        `Step 3 of 7: Active, since ${short('2026-10-30T02:00:00Z')}. Show all steps`,
      );
      expect(summary?.closest('details')?.open).toBe(false);
      expect(steps()).toHaveLength(7);
    });

    it('names the exit in the one line once the contract left the path', () => {
      card({
        contract: contract({ status: 'OVERDUE', statusChangedAt: '2026-12-02T02:00:00Z' }),
      });
      expect(document.querySelector('summary')?.textContent).toBe(
        `Step 5 of 7: Overdue, since ${short('2026-12-02T02:00:00Z')}. Show all steps`,
      );
    });
  });
});
