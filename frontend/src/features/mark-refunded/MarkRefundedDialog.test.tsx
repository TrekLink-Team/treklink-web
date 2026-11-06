// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/apiClient';
import { MarkRefundedDialog } from './MarkRefundedDialog';

const markInvoiceRefunded = vi.fn();
vi.mock('../../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/billing/api')>()),
  markInvoiceRefunded: (...args: unknown[]) => markInvoiceRefunded(...args),
}));

const INVOICE = {
  id: 'i-9',
  number: 'INV-2026-000009',
  organization: { id: 'o-1', code: 'ORG-0001' },
  contract: { id: 'c-1', code: 'RC-2026-0001' },
  kind: 'CLOSING',
  term: null,
  status: 'CREDIT_DUE' as const,
  totalVnd: -720_000,
  paidVnd: 0,
  creditDueVnd: 720_000,
  refund: null,
  issuedAt: '2026-11-06T03:00:00Z',
};

const show = (onClose = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MarkRefundedDialog invoice={INVOICE} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
};

afterEach(() => {
  cleanup();
  markInvoiceRefunded.mockReset();
});

// billing api-design 23 (D-097 amended, design section 11.5).
describe('MarkRefundedDialog', () => {
  it('names the amount owed and sends the trimmed note', async () => {
    markInvoiceRefunded.mockResolvedValue({ ...INVOICE, status: 'REFUNDED' });
    const onClose = show();
    expect(screen.getByText('720,000 VND')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: '  Bank transfer FT26110600042 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark refunded' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(markInvoiceRefunded).toHaveBeenCalledWith('i-9', 'Bank transfer FT26110600042');
  });

  it('names the field and the fix when the note is empty, and sends nothing', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Mark refunded' }));
    expect(screen.getByText(/Note is required/)).toBeTruthy();
    expect(screen.getByLabelText(/^Note/).getAttribute('aria-invalid')).toBe('true');
    expect(markInvoiceRefunded).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the note", async () => {
    markInvoiceRefunded.mockRejectedValue(
      new ApiError(409, 'NOTHING_OWED', 'Nothing is owed to the organization on this invoice yet.'),
    );
    show();
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Cash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark refunded' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText(/^Note/) as HTMLTextAreaElement).value).toBe('Cash');
  });
});
