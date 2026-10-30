import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { contractKeys, giveNotice, type ContractDetail } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDate, formatVnd } from '../../shared/lib/format';
import { Dialog } from '../../shared/ui/Dialog';
import { useToast } from '../../shared/ui/toastStore';
import { ALERT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../shared/ui/styles';

// Give notice of screen 5.2 (rentals api-design 12): an ACTIVE monthly contract ends with its
// current term; the page shows MSG18 with the date and the amount due then.
export const NoticeDialog: React.FC<{ contract: ContractDetail; onClose: () => void }> = ({
  contract,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const termEnd = contract.currentTerm?.endsAt;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.all }),
      queryClient.invalidateQueries({ queryKey: contractKeys.transitions(contract.id) }),
    ]);

  const confirm = async () => {
    setPending(true);
    try {
      const ending = await giveNotice(contract.id, contract.version);
      await refresh();
      showToast(
        `Notice recorded. The contract ends on ${formatDate(ending.endsAt ?? termEnd ?? '')}; ${formatVnd(ending.dueAtEndVnd)} is due then.`,
      );
      onClose();
    } catch (failure) {
      setPending(false);
      const stale = failure instanceof ApiError && failure.errorCode === 'STALE_VERSION';
      setError({
        message: failure instanceof ApiError ? failure.message : 'Something went wrong.',
        stale,
      });
      if (failure instanceof ApiError && failure.errorCode === 'INVALID_STATE_TRANSITION') {
        void refresh();
      }
    }
  };

  return (
    <Dialog titleId="notice-title" title={`Give notice on ${contract.code}?`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          The contract ends at the end of the current term
          {termEnd ? `, ${formatDate(termEnd)}` : ''}. The term balance is due then and the devices
          are returned at the counter.
        </p>
        {error && (
          <div role="alert" className={`${ALERT} flex items-center justify-between gap-3`}>
            <span>{error.message}</span>
            {error.stale && (
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  void refresh();
                  onClose();
                }}
              >
                Reload
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={pending}
            onClick={() => void confirm()}
            className={`${PRIMARY_BUTTON} flex-1`}
          >
            {pending ? 'Recording…' : 'Give notice'}
          </button>
          <button type="button" onClick={onClose} className={`${SECONDARY_BUTTON} flex-1`}>
            Keep the contract running
          </button>
        </div>
      </div>
    </Dialog>
  );
};
