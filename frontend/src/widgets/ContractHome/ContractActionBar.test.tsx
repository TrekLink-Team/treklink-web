// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractActionBar, type HomeTab } from './ContractActionBar';
import type { HomeActions } from './policy';

// The sticky row of the contract home (chapter 06 §10.4 to §10.6, §11.1, treklink-web#450). Only
// useMediaQuery is mocked, to pick the layout; Tabs, Menu and Button run for real. stickyEdges.test
// covers the published height across 768 px, so this file leaves it out.
const media = { wide: true };
vi.mock('../../shared/lib/useMediaQuery', () => ({ useMediaQuery: () => media.wide }));

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'devices', label: 'Devices' },
  { key: 'money', label: 'Money' },
] as { key: HomeTab; label: string }[];

const ACTIONS: HomeActions = {
  primary: { key: 'handover', label: 'Start handover' },
  idle: null,
  more: [
    { key: 'notice', label: 'Give notice' },
    { key: 'close', label: 'Close contract', reason: 'Two units are still out.' },
    { key: 'end', label: 'End contract now', destructive: true },
  ],
};

const onTab = vi.fn();
const onAction = vi.fn();
const show = (props: Partial<React.ComponentProps<typeof ContractActionBar>> = {}) =>
  render(
    <MemoryRouter>
      <ContractActionBar
        tabs={TABS}
        tab="overview"
        onTab={onTab}
        overviewHref="/t/contracts/c-1"
        actions={ACTIONS}
        onAction={onAction}
        {...props}
      />
    </MemoryRouter>,
  );

const wideRow = () => screen.getByRole('region', { name: 'Contract sections and actions' });
const openMore = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

beforeEach(() => {
  media.wide = true;
  onTab.mockReset();
  onAction.mockReset();
});
afterEach(cleanup);

describe('ContractActionBar', () => {
  describe('from 768 px', () => {
    it('puts the tabs and the actions in one row, with the current tab selected', () => {
      show({ tab: 'devices' });
      const row = wideRow();
      const tabs = within(row).getAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Devices', 'Money']);
      expect(within(row).getByRole('tab', { name: 'Devices' }).getAttribute('aria-selected')).toBe(
        'true',
      );
      expect(within(row).getByRole('button', { name: 'Start handover' })).toBeTruthy();
      expect(within(row).getByRole('button', { name: 'More actions' })).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Contract actions' })).toBeNull();
    });

    it('reports the chosen tab', () => {
      show();
      fireEvent.click(screen.getByRole('tab', { name: 'Money' }));
      expect(onTab).toHaveBeenCalledWith('money');
    });

    it('runs the primary action on click', () => {
      show();
      fireEvent.click(screen.getByRole('button', { name: 'Start handover' }));
      expect(onAction).toHaveBeenCalledWith('handover');
    });

    it('shows the mode title and Back to overview in place of the tabs', () => {
      show({ modeTitle: 'Review request' });
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Review request' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Back to overview' }).getAttribute('href')).toBe(
        '/t/contracts/c-1',
      );
    });

    it('shows the idle text when nothing is due from this viewer', () => {
      show({ actions: { primary: null, idle: 'Waiting for TrekLink to approve.', more: [] } });
      expect(within(wideRow()).getByText('Waiting for TrekLink to approve.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    });

    it('shows no idle text beside a primary action', () => {
      show({ actions: { ...ACTIONS, idle: 'Waiting for TrekLink to approve.' } });
      expect(screen.queryByText('Waiting for TrekLink to approve.')).toBeNull();
    });
  });

  describe('an unavailable primary action', () => {
    const blocked: HomeActions = {
      primary: { key: 'approve', label: 'Approve request', reason: 'Not enough units in stock.' },
      idle: null,
      more: [],
    };

    it('stays visible, marked unavailable and described by its reason', () => {
      show({ actions: blocked });
      const button = screen.getByRole('button', { name: 'Approve request' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toBe('Not enough units in stock.');
    });

    it('does nothing on click, and does not submit the form it would submit', () => {
      const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
      render(
        <MemoryRouter>
          <form id="review-form" onSubmit={submit} />
          <ContractActionBar
            tabs={TABS}
            tab="overview"
            onTab={onTab}
            overviewHref="/t/contracts/c-1"
            actions={blocked}
            onAction={onAction}
            primaryForm="review-form"
          />
        </MemoryRouter>,
      );
      const button = screen.getByRole('button', { name: 'Approve request' }) as HTMLButtonElement;
      expect(button.type).toBe('button');
      expect(button.getAttribute('form')).toBeNull();
      fireEvent.click(button);
      expect(onAction).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    });
  });

  describe('a primary action that submits a form (Approve request in Review mode)', () => {
    const approve: HomeActions = {
      primary: { key: 'approve', label: 'Approve request' },
      idle: null,
      more: [],
    };

    it('submits that form and leaves onAction to the form', () => {
      show({ actions: approve, primaryForm: 'review-form' });
      const button = screen.getByRole('button', { name: 'Approve request' }) as HTMLButtonElement;
      expect(button.type).toBe('submit');
      expect(button.getAttribute('form')).toBe('review-form');
      fireEvent.click(button);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('is busy and disabled while the request is pending', () => {
      show({ actions: approve, primaryForm: 'review-form', primaryPending: true });
      const button = screen.getByRole('button', { name: 'Approve request' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('More actions', () => {
    it('lists the other actions, the destructive one last after a separator', () => {
      show();
      openMore();
      const menu = screen.getByRole('menu', { name: 'More actions' });
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent),
      ).toEqual(['Give notice', 'Close contract', 'End contract now']);
      const separator = within(menu).getByRole('separator');
      const end = within(menu).getByRole('menuitem', { name: 'End contract now' });
      expect(
        separator.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    });

    it('runs an available action', () => {
      show();
      openMore();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Give notice' }));
      expect(onAction).toHaveBeenCalledWith('notice');
    });

    it('keeps an unavailable action in the list with its reason, and does not run it', () => {
      show();
      openMore();
      const close = screen.getByRole('menuitem', { name: 'Close contract' });
      expect(close.getAttribute('aria-disabled')).toBe('true');
      const reason = document.getElementById(close.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toBe('Two units are still out.');
      fireEvent.click(close);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('draws no separator when no action is destructive', () => {
      show({ actions: { ...ACTIONS, more: ACTIONS.more.slice(0, 2) } });
      openMore();
      expect(within(screen.getByRole('menu')).queryByRole('separator')).toBeNull();
    });
  });

  describe('below 768 px', () => {
    beforeEach(() => {
      media.wide = false;
    });

    it('keeps the tabs at the top and pins the actions to a bar of their own', () => {
      show();
      expect(screen.queryByRole('region', { name: 'Contract sections and actions' })).toBeNull();
      const top = screen.getByRole('region', { name: 'Contract navigation' });
      expect(within(top).getByRole('tablist', { name: 'Contract sections' })).toBeTruthy();
      expect(within(top).queryByRole('button', { name: 'Start handover' })).toBeNull();
      const bar = screen.getByRole('group', { name: 'Contract actions' });
      expect(within(bar).getByRole('button', { name: 'Start handover' })).toBeTruthy();
      expect(within(bar).getByRole('button', { name: 'More actions' })).toBeTruthy();
    });

    it('shows the reason of an unavailable primary action in the bottom bar', () => {
      show({
        actions: {
          primary: { key: 'approve', label: 'Approve request', reason: 'Not enough units.' },
          idle: null,
          more: [],
        },
      });
      expect(
        within(screen.getByRole('group', { name: 'Contract actions' })).getByText(
          'Not enough units.',
        ),
      ).toBeTruthy();
    });

    it('keeps More actions in the top row for a mode without a primary action (Handover)', () => {
      show({ modeTitle: 'Handover', actions: { primary: null, idle: null, more: ACTIONS.more } });
      const top = screen.getByRole('region', { name: 'Contract navigation' });
      expect(within(top).getByRole('heading', { name: 'Handover' })).toBeTruthy();
      expect(within(top).getByRole('button', { name: 'More actions' })).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Contract actions' })).toBeNull();
    });

    it('shows the idle text in the bottom bar', () => {
      show({ actions: { primary: null, idle: 'Nothing is due from you.', more: [] } });
      expect(
        within(screen.getByRole('group', { name: 'Contract actions' })).getByText(
          'Nothing is due from you.',
        ),
      ).toBeTruthy();
    });

    it('draws no bottom bar when there is nothing to put in it', () => {
      show({ actions: { primary: null, idle: null, more: [] } });
      expect(screen.queryByRole('group', { name: 'Contract actions' })).toBeNull();
    });
  });
});
