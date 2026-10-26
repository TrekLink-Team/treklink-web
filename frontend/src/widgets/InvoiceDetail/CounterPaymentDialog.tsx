import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { recordCounterPayment, type InvoiceDetail } from '../../entities/billing/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatVnd } from '../../shared/lib/format';
import { Field } from '../../shared/ui/bits';
import { invalid } from '../../shared/ui/errors';
import { Dialog } from '../../shared/ui/Dialog';
import { useToast } from '../../shared/ui/toastStore';
import { ALERT, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../shared/ui/styles';

interface Errors {
  amountVnd?: string;
  reference?: string;
  form?: string;
}

// Screen 6.3: one step of three fields (billing api-design 13). Record stays disabled while the
// server answers, so a double click records nothing twice; a failed submit keeps every field.
export const CounterPaymentDialog: React.FC<{ invoice: InvoiceDetail; onClose: () => void }> = ({
  invoice,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const due = Math.max(invoice.totalVnd - invoice.paidVnd, 0);
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [amount, setAmount] = useState(String(due));
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amountVnd = Number(amount.replace(/[,\s]/g, ''));
    const found: Errors = {};
    if (!Number.isInteger(amountVnd) || amountVnd < 1 || amountVnd > due) {
      found.amountVnd = `Amount received must be between 1 and ${due}.`;
    }
    if (reference.trim() === '') found.reference = 'Receipt number or bank reference is required.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      const payment = await recordCounterPayment(invoice.id, {
        method,
        amountVnd,
        reference: reference.trim(),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['contract-balance', invoice.contract.id] }),
      ]);
      showToast(`Payment of ${formatVnd(payment.amountVnd)} received.`);
      onClose();
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'OVERPAYMENT') {
        setErrors({ amountVnd: failure.message });
      } else if (failure instanceof ApiError && failure.errorCode === 'DUPLICATE_REFERENCE') {
        setErrors({ reference: failure.message });
      } else {
        setErrors({
          form: failure instanceof ApiError ? failure.message : 'Something went wrong.',
        });
      }
    }
  };

  const close = () => {
    const filled = reference !== '' || amount !== String(due);
    if (!filled || window.confirm('Discard this payment?')) onClose();
  };

  return (
    <Dialog titleId="counter-title" title="Record counter payment" onClose={close}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-slate-700">
          {invoice.number}, contract {invoice.contract.code ?? invoice.contract.id}
          {invoice.organization.code ? `, ${invoice.organization.code}` : ''}. Still due:{' '}
          <strong>{formatVnd(due)}</strong>
        </p>
        {errors.form && (
          <div role="alert" className={ALERT}>
            {errors.form}
          </div>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-semibold text-slate-900">Method</legend>
          <div className="flex gap-4">
            {(['CASH', 'BANK_TRANSFER'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="method"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                />
                {value === 'CASH' ? 'Cash' : 'Bank transfer'}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="counter-amount" label="Amount received (VND)" error={errors.amountVnd}>
          <input
            id="counter-amount"
            inputMode="numeric"
            className={`${INPUT} text-right`}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            {...invalid('counter-amount', errors.amountVnd)}
          />
        </Field>
        <Field
          id="counter-reference"
          label="Receipt number or bank reference"
          error={errors.reference}
        >
          <input
            id="counter-reference"
            className={INPUT}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            {...invalid('counter-reference', errors.reference)}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} flex-1`}>
            {pending ? 'Recording…' : 'Record'}
          </button>
          <button type="button" onClick={close} className={`${SECONDARY_BUTTON} flex-1`}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
};
