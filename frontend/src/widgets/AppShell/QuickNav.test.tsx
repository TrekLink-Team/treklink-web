// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FileText, Receipt, Siren } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NavGroup } from '../../shared/config/navigation';
import { QuickNav } from './QuickNav';
import { useShell } from './shellStore';

// "Go to" in the header (Ctrl K or /): it searches page names only, ignoring Vietnamese diacritics.
// The shell store and the router run for real; the page shown is read from the location.

const groups: NavGroup[] = [
  {
    id: 'staff',
    label: 'Operate',
    entries: [
      { route: '/t/incidents', label: 'Incidents', icon: Siren, roles: ['STAFF'], built: true },
      { route: '/t/contracts', label: 'Hợp đồng', icon: FileText, roles: ['STAFF'], built: true },
    ],
  },
  {
    id: 'money',
    label: 'Billing',
    entries: [
      {
        route: '/t/billing',
        label: 'Invoices and payments',
        icon: Receipt,
        roles: ['STAFF'],
        built: true,
      },
    ],
  },
];

const Where: React.FC = () => <output aria-label="Location">{useLocation().pathname}</output>;

const renderNav = () =>
  render(
    <MemoryRouter initialEntries={['/t/home']}>
      <QuickNav groups={groups} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

const open = () => act(() => useShell.getState().setQuickNav(true));
const input = () => screen.getByRole('combobox', { name: 'Go to page' });
const options = () =>
  within(screen.getByRole('listbox', { name: 'Pages' })).queryAllByRole('option');
const location = () => screen.getByRole('status', { name: 'Location' }).textContent;

beforeEach(() => useShell.setState({ quickNavOpen: false }));
afterEach(cleanup);

describe('QuickNav', () => {
  describe('opening', () => {
    it('renders nothing until it is opened', () => {
      renderNav();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each([
      ['Ctrl K', { key: 'k', ctrlKey: true }],
      ['Cmd K', { key: 'K', metaKey: true }],
      ['/', { key: '/' }],
    ])('opens on %s', (_label, init) => {
      renderNav();
      fireEvent.keyDown(window, init);
      expect(screen.getByRole('dialog', { name: 'Go to page' })).toBeTruthy();
      expect(useShell.getState().quickNavOpen).toBe(true);
    });

    it('ignores / while the user types in a field, but still opens on Ctrl K there', () => {
      renderNav();
      const field = document.createElement('input');
      document.body.appendChild(field);
      fireEvent.keyDown(field, { key: '/' });
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.keyDown(field, { key: 'k', ctrlKey: true });
      expect(screen.getByRole('dialog')).toBeTruthy();
      field.remove();
    });

    it('ignores a plain k', () => {
      renderNav();
      fireEvent.keyDown(window, { key: 'k' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('searching', () => {
    it('lists every page with its group, the first one active', () => {
      renderNav();
      open();
      expect(options().map((option) => option.textContent)).toEqual([
        'IncidentsOperate',
        'Hợp đồngOperate',
        'Invoices and paymentsBilling',
      ]);
      expect(options()[0].getAttribute('aria-selected')).toBe('true');
      expect(input().getAttribute('aria-activedescendant')).toBe('quicknav-0');
    });

    it('matches without diacritics, so "hop dong" finds "Hợp đồng"', () => {
      renderNav();
      open();
      fireEvent.change(input(), { target: { value: 'hop dong' } });
      expect(options().map((option) => option.textContent)).toEqual(['Hợp đồngOperate']);
    });

    it('matches the group name too, ignoring case and surrounding spaces', () => {
      renderNav();
      open();
      fireEvent.change(input(), { target: { value: '  BILLING ' } });
      expect(options().map((option) => option.textContent)).toEqual([
        'Invoices and paymentsBilling',
      ]);
    });

    it('says so when no page matches and leaves no active option', () => {
      renderNav();
      open();
      fireEvent.change(input(), { target: { value: 'zzz' } });
      expect(options()).toHaveLength(0);
      expect(screen.getByText('No page matches.')).toBeTruthy();
      expect(input().getAttribute('aria-activedescendant')).toBeNull();
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  describe('choosing', () => {
    it('moves with the arrow keys, stops at both ends, and goes on Enter', () => {
      renderNav();
      open();
      fireEvent.keyDown(input(), { key: 'ArrowUp' });
      expect(input().getAttribute('aria-activedescendant')).toBe('quicknav-0');
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      expect(input().getAttribute('aria-activedescendant')).toBe('quicknav-2');
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(location()).toBe('/t/billing');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useShell.getState().quickNavOpen).toBe(false);
    });

    it('resets the active option to the first one when the query changes', () => {
      renderNav();
      open();
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      fireEvent.change(input(), { target: { value: 'o' } });
      expect(input().getAttribute('aria-activedescendant')).toBe('quicknav-0');
    });

    it('goes to a page on click, and follows the pointer for the active option', () => {
      renderNav();
      open();
      fireEvent.mouseEnter(options()[1]);
      expect(options()[1].getAttribute('aria-selected')).toBe('true');
      fireEvent.click(options()[1]);
      expect(location()).toBe('/t/contracts');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on Escape without moving', () => {
      renderNav();
      open();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(location()).toBe('/t/home');
    });
  });
});
