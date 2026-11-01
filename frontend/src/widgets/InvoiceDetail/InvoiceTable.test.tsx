// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Invoice } from '../../entities/billing/api';
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

describe('InvoiceTable (screen 6.1 on DataTable, W29)', () => {
  const setup = (onFilters = vi.fn(), onOpen = vi.fn()) => {
    render(
      <MemoryRouter>
        <InvoiceTable
          invoices={[invoice({}), invoice({ id: 'i-2', number: 'INV-2026-0002', organization: { id: 'o-2', code: 'ORG-0002' } })]}
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

  it('sends the status and overdue filters to the server from page 1', () => {
    const { onFilters } = setup();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAID' } });
    expect(onFilters).toHaveBeenLastCalledWith({ pageNumber: 1, status: 'PAID' });
    fireEvent.click(screen.getByLabelText('Overdue only'));
    expect(onFilters).toHaveBeenLastCalledWith({ pageNumber: 1, overdue: true });
  });
});
