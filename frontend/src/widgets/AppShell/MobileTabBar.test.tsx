// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FileText, Receipt, Siren } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavGroup } from '../../shared/config/navigation';
import { MobileTabBar } from './MobileTabBar';

const groups: NavGroup[] = [
  {
    id: 'staff',
    label: 'Operate',
    entries: [
      { route: '/t/incidents', label: 'Incidents', icon: Siren, roles: ['STAFF'], built: true, tabBar: 1 },
      { route: '/t/contracts', label: 'Contracts', icon: FileText, roles: ['STAFF'], built: true, tabBar: 2 },
      { route: '/t/billing', label: 'Invoices and payments', icon: Receipt, roles: ['STAFF'], built: true, tabBar: 3 },
    ],
  },
];

afterEach(cleanup);

describe('MobileTabBar (phone tab bar)', () => {
  it('shows the first part of an "X and Y" label and keeps the full label as the name (W20B item 8)', () => {
    render(
      <MemoryRouter>
        <MobileTabBar groups={groups} onMore={vi.fn()} />
      </MemoryRouter>,
    );
    const bar = within(screen.getByRole('navigation', { name: 'Main' }));
    const billing = bar.getByRole('link', { name: 'Invoices and payments' });
    expect(billing.textContent).toBe('Invoices');
    // A label that fits keeps its text and its name, with no extra aria-label.
    const contracts = bar.getByRole('link', { name: 'Contracts' });
    expect(contracts.textContent).toBe('Contracts');
    expect(contracts.hasAttribute('aria-label')).toBe(false);
    expect(bar.getByRole('button', { name: 'More' })).toBeTruthy();
  });
});
