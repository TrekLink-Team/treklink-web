import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { markInvoiceRefunded, type Invoice } from '../../entities/billing/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatVnd } from '../../shared/lib/format';
import { Field } from '../../shared/ui/bits';
import { invalid } from '../../shared/ui/errors';
import { Dialog } from '../../shared/ui/Dialog';
import { useToast } from '../../shared/ui/toastStore';
import { ALERT, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../shared/ui/styles';

const NOTE_MAX = 500;

// Mark refunded (billing design section 11.5, api-design 23, D-097 amended): Staff record that the credit
// TrekLink owed the organization was refunded outside TrekLink, with a note such as the bank-transfer
// reference. Record stays disabled while the server answers, so a double click records nothing twice.
export const MarkRefundedDialog: React.FC<{ invoice: Invoice; onClose: () => void }> = ({
  invoice,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const amount = formatVnd(invoice.creditDueVnd ?? 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed === '') {
      setError(
        'Note is required: write how the refund was made, such as the bank-transfer reference.',
      );
      return;
    }
    setError(null);
    setPending(true);
    try {
      await markInvoiceRefunded(invoice.id, trimmed);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['contract-balance', invoice.contract.id] }),
      ]);
      showToast('Refund recorded.');
      onClose();
    } catch (caught) {
      setPending(false);
      setFailure(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    }
  };

  return (
    <Dialog titleId="refund-title" title={`Mark ${invoice.number} refunded?`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink">
          TrekLink owes the organization <strong>{amount}</strong> on this invoice. Record the
          refund only once it was made outside TrekLink.
        </p>
        {failure && (
          <div role="alert" className={ALERT}>
            {failure}
          </div>
        )}
        <Field id="refund-note" label="Note" error={error ?? undefined}>
          <textarea
            id="refund-note"
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            className={INPUT}
            {...invalid('refund-note', error ?? undefined)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
            {pending ? 'Recording' : 'Mark refunded'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
