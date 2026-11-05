import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  contractKeys,
  endContract,
  fetchEndPreview,
  type ContractDetail,
} from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Field, Textarea } from '../../shared/ui/Field';
import { messageOf } from '../../shared/ui/errors';
import { ALERT } from '../../shared/ui/styles';
import { useToast } from '../../shared/ui/toastStore';
import { creditText, owedText } from './endNowText';

const REASON_MAX = 500;
const FORM_ID = 'end-now-form';
const REASON_ID = 'end-now-reason';

/**
 * End contract now (screen 5.2, rentals api-design 30 and 31, D-097): Staff or the Org Manager end an
 * ACTIVE or ENDING contract at once with a reason. The dialog names the contract, the end time, the
 * credit for the unused days and the consequence, all from the server's preview; focus starts on Keep
 * the contract running. A preview that fails keeps End contract now disabled and names the error.
 */
export const EndNowDialog: React.FC<{
  contract: ContractDetail;
  viewer: 'staff' | 'manager';
  onClose: () => void;
}> = ({ contract, viewer, onClose }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const keep = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const preview = useQuery({
    queryKey: contractKeys.endPreview(contract.id),
    queryFn: () => fetchEndPreview(contract.id),
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
    try {
      await endContract(contract.id, trimmed, contract.version);
    } catch (error) {
      setPending(false);
      const stale = error instanceof ApiError && error.errorCode === 'STALE_VERSION';
      setFailure({ message: messageOf(error), stale });
      if (error instanceof ApiError && error.errorCode === 'INVALID_STATE_TRANSITION')
        void refresh();
      return;
    }
    await refresh();
    showToast('Contract ended. Check the units in at the counter.');
    onClose();
  };

  const ready = preview.data;
  return (
    <Dialog
      titleId="end-now-title"
      title={`End ${contract.code} now?`}
      role="alertdialog"
      onClose={onClose}
      initialFocus={keep}
      footer={
        <>
          <Button ref={keep} variant="ghost" onClick={onClose} disabled={pending}>
            Keep the contract running
          </Button>
          <Button variant="danger" type="submit" form={FORM_ID} loading={pending} disabled={!ready}>
            End contract now
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
          <p className="text-body-sm text-ink-muted">Reading what ending now does…</p>
        )}
        {preview.error && (
          <p role="alert" className={ALERT}>
            {messageOf(preview.error)}
          </p>
        )}
        {ready && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-body sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-ink">Ends</dt>
            <dd className="text-ink">Now, {formatDateTime(ready.endsAt)}</dd>
            <dt className="font-semibold text-ink">Credit</dt>
            <dd className="text-ink">{creditText(ready)}</dd>
            <dt className="font-semibold text-ink">After it</dt>
            <dd className="text-ink">
              {owedText(ready, viewer, contract.organization?.legalName ?? 'the organization')}
            </dd>
          </dl>
        )}
        <p className="text-body-sm text-ink">
          The contract becomes Return due at once and cannot run again. Every unit goes back to the
          TrekLink counter; late fees start after the grace, counted from now.
        </p>
        <Field
          id={REASON_ID}
          label="Reason"
          required
          hint={`Recorded on the contract history and the invoice line, at most ${REASON_MAX} characters.`}
          error={missing ? 'Enter why the contract ends now.' : undefined}
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
