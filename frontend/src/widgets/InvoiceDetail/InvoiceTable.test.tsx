// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Invoice, InvoiceFilters } from '../../entities/billing/api';
import { InvoiceTable } from './InvoiceTable';

const invoice = (overrides: Partial<Invoice>): Invoice => ({
  id: 'i-1',
  number: 'INV-2026-0001',
  organization: { id: 'o-1', code: 'ORG-0001' },
  contract: { id: 'c-1', code: 'RC-2026-0001' },
  kind: 'TERM',
  term: { seq: 1 },
  status: 'ISSUED',
  totalVnd: 2_250_000,
  paidVnd: 0,
  issuedAt: '2026-10-30T03:00:00Z',
  ...overrides,
}) as Invoice;

afterEach(cleanup);

describe('InvoiceTable (screen 6.1 on CollectionView, D-096)', () => {
  const setup = (onFilters = vi.fn(), onOpen = vi.fn()) => {
    render(
      <MemoryRouter>
        <InvoiceTable
          // Three invoices: one or two would hide the command bar (chapter 06 §9.3).
          invoices={[
            invoice({}),
            invoice({ id: 'i-2', number: 'INV-2026-0002', organization: { id: 'o-2', code: 'ORG-0002' } }),
            invoice({ id: 'i-3', number: 'INV-2026-0003' }),
          ]}
          showOrganization
          filters={{ pageNumber: 1 }}
          onFilters={onFilters}
          onOpen={onOpen}
        />
      </MemoryRouter>,
    );
    return { onFilters, onOpen };
  };

  it('opens a row through its number button and narrows the page by organization', () => {
    const { onOpen } = setup();
    const table = within(screen.getByRole('table', { name: 'Invoices' }));
    fireEvent.click(table.getByRole('button', { name: 'INV-2026-0002' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'i-2' }));
    fireEvent.change(screen.getByLabelText('Search by number, organization or contract'), { target: { value: 'ORG-0001' } });
    expect(table.queryByRole('button', { name: 'INV-2026-0002' })).toBeNull();
  });

  // W26: exactly the allowlisted columns sort, on the server, and keep the other filters.
  it('sends the header sort to the server from page 1 and marks the allowlisted columns', () => {
    const { onFilters } = setup();
    const table = within(screen.getByRole('table', { name: 'Invoices' }));
    fireEvent.click(table.getByRole('button', { name: 'Paid' }));
    expect(onFilters).toHaveBeenLastCalledWith({ pageNumber: 1, sort: 'paidVnd', order: 'asc' });
    fireEvent.click(table.getByRole('button', { name: 'Invoice' }));
    expect(onFilters).toHaveBeenLastCalledWith({ pageNumber: 1, sort: 'number', order: 'asc' });
    const sortable = table
      .getAllByRole('columnheader')
      .filter((cell) => cell.querySelector('[data-sort-icon]'))
      .map((cell) => cell.textContent);
    expect(sortable).toEqual(['Invoice', 'Status', 'Total', 'Paid', 'Issued']);
  });

  it('sends the status and overdue filters to the server from page 1', () => {
    const { onFilters } = setup();
    // A status and Overdue only combine in Show (review of treklink-web#350).
    fireEvent.click(screen.getByRole('button', { name: /^Show: Every status/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Partly paid' }));
    expect(onFilters).toHaveBeenLastCalledWith({ pageNumber: 1, status: 'PARTIALLY_PAID' });
    fireEvent.click(screen.getByRole('button', { name: /^Show: / }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Due: Overdue only' }));
    expect(onFilters).toHaveBeenLastCalledWith({ pageNumber: 1, overdue: true });
  });

  it('keeps the status when Overdue only is added (review of treklink-web#350)', () => {
    const seen: InvoiceFilters[] = [];
    const Harness: React.FC = () => {
      const [filters, setFilters] = React.useState<InvoiceFilters>({ pageNumber: 1 });
      return (
        <InvoiceTable
          invoices={[invoice({}), invoice({ id: 'i-2', number: 'INV-2026-0002' }), invoice({ id: 'i-3', number: 'INV-2026-0003' })]}
          showOrganization
          filters={filters}
          onFilters={(next) => {
            seen.push(next);
            setFilters(next);
          }}
          onOpen={() => undefined}
        />
      );
    };
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Show: Every status/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Partly paid' }));
    fireEvent.click(screen.getByRole('button', { name: /^Show: Partly paid/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Due: Overdue only' }));
    expect(seen.at(-1)).toEqual({ pageNumber: 1, status: 'PARTIALLY_PAID', overdue: true });
    expect(screen.getByRole('button', { name: /^Show: Partly paid, Due: Overdue only/ })).toBeTruthy();
  });

  // TK-212: on /t/billing the list sits beside its own invoice panel, so the columns the panel repeats
  // leave by the list's width (below 1100 px), and the table fits at 900 px and beside an open invoice.
  it('lets the organization, kind and issued columns leave a narrow TrekLink list', () => {
    setup();
    const narrow = (name: string) =>
      screen.getByRole('columnheader', { name: new RegExp(`^${name}`) }).className.includes(
        '[@container(max-width:1099px)]:hidden',
      );
    expect(['Organization', 'Kind', 'Issued'].map(narrow)).toEqual([true, true, true]);
    expect(['Contract', 'Status', 'Total', 'Paid'].map(narrow)).toEqual([false, false, false, false]);
  });
});
