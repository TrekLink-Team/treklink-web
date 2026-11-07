import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { serviceCreditKeys } from '../../entities/billing/api';
import {
  contractKeys,
  fetchReleasePreview,
  releaseUnit,
  type ContractDetail,
  type ContractDevice,
  type ReleasePreview,
} from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatVnd } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Field, Textarea } from '../../shared/ui/Field';
import { messageOf } from '../../shared/ui/errors';
import { ALERT } from '../../shared/ui/styles';
import { useToast } from '../../shared/ui/toastStore';

const REASON_MAX = 500;
const FORM_ID = 'release-unit-form';
const REASON_ID = 'release-unit-reason';

// What the release does to the money, as text from the server's preview (nothing computed here).
const moneyText = (preview: ReleasePreview): string => {
  if (preview.phase === 'BEFORE_HANDOVER') {
    if (!preview.firstInvoice) return 'No invoice was issued yet, so nothing changes in money.';
    const owed = preview.firstInvoice.owedToOrganizationVnd;
    return `The first invoice drops from ${formatVnd(preview.firstInvoice.totalVnd)} to ${formatVnd(
      preview.firstInvoice.newTotalVnd,
    )}.${owed > 0 ? ` ${formatVnd(owed)} already paid is owed back and refunded outside TrekLink.` : ''}`;
  }
  const credit = preview.credit;
  if (!credit || !credit.applies) {
    return credit && credit.termDays > 0
      ? 'No credit: the term ends today.'
      : 'No credit: day plans are billed per day.';
  }
  return `A credit of ${formatVnd(credit.computedVnd)} for ${credit.unusedDays} unused day${
    credit.unusedDays === 1 ? '' : 's'
  } of ${credit.termDays}. An Admin approves it before it reaches an invoice.`;
};

/**
 * Release a unit (screen 5.2 "Release a unit", rentals api-design 33 and 34, D-099): TrekLink Staff give
 * one unit back before the term end with a reason. The dialog names the unit, the quantity before and
 * after, and the money from the server's preview; focus starts on Keep the unit. A preview that fails
 * keeps Release disabled and names the error.
 */
export const ReleaseUnitDialog: React.FC<{
  contract: ContractDetail;
  device: ContractDevice;
  onClose: () => void;
}> = ({ contract, device, onClose }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const keep = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const tag = device.assetTag ?? device.deviceId;
  const preview = useQuery({
    queryKey: contractKeys.releasePreview(contract.id, device.deviceId),
    queryFn: () => fetchReleasePreview(contract.id, device.deviceId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.balance(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.all }),
      queryClient.invalidateQueries({ queryKey: contractKeys.transitions(contract.id) }),
      queryClient.invalidateQueries({ queryKey: serviceCreditKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    ]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || !preview.data) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setMissing(true);
      return;
    }
    setPending(true);
    setFailure(null);
    let quantity: number;
    try {
      quantity = (await releaseUnit(contract.id, device.deviceId, trimmed, contract.version))
        .contract.quantity;
    } catch (error) {
      setPending(false);
      const stale = error instanceof ApiError && error.errorCode === 'STALE_VERSION';
      setFailure({ message: messageOf(error), stale });
      return;
    }
    await refresh();
    showToast(`Unit released. The quantity is now ${quantity}.`);
    onClose();
  };

  const ready = preview.data;
  return (
    <Dialog
      titleId="release-unit-title"
      title={`Release ${tag} from ${contract.code}?`}
      role="alertdialog"
      onClose={onClose}
      initialFocus={keep}
      footer={
        <>
          <Button ref={keep} variant="ghost" onClick={onClose} disabled={pending}>
            Keep the unit
          </Button>
          <Button variant="danger" type="submit" form={FORM_ID} loading={pending} disabled={!ready}>
            Release
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        {preview.isLoading && (
          <p className="text-body-sm text-ink-muted">Reading what the release does…</p>
        )}
        {preview.error && (
          <p role="alert" className={ALERT}>
            {messageOf(preview.error)}
          </p>
        )}
        {ready && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-body sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-ink">Quantity</dt>
            <dd className="text-ink">
              {ready.quantityBefore} to {ready.quantityAfter} units
            </dd>
            <dt className="font-semibold text-ink">Money</dt>
            <dd className="text-ink">{moneyText(ready)}</dd>
          </dl>
        )}
        {ready?.phase === 'RUNNING' && (
          <p className="text-body-sm text-ink">
            Bring the unit to the counter first: it is checked in now, then reset and inspected.
          </p>
        )}
        <Field
          id={REASON_ID}
          label="Reason"
          required
          hint={`Recorded on the contract history, at most ${REASON_MAX} characters.`}
          error={missing ? 'Enter why the organization gives the unit back.' : undefined}
        >
          <Textarea
            id={REASON_ID}
            value={reason}
            maxLength={REASON_MAX}
            required
            rows={2}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? `${REASON_ID}-error` : `${REASON_ID}-hint`}
            readOnly={pending}
            onChange={(event) => {
              setReason(event.target.value);
              if (event.target.value.trim()) setMissing(false);
            }}
          />
        </Field>
        {failure && (
          <div
            role="alert"
            className={`${ALERT} flex flex-wrap items-center justify-between gap-3`}
          >
            <span>{failure.message}</span>
            {failure.stale && (
              <Button
                variant="ghost"
                onClick={() => {
                  void refresh();
                  onClose();
                }}
              >
                Reload
              </Button>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
};
