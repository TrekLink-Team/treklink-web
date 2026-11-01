import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { closeContract, contractKeys } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { ConfirmDialog, useToast } from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';

// The close of rentals api-design 17 behind its confirmation (screens 5.2 and 5.5). The version sent
// is the one the close check read, so a contract changed since answers STALE_VERSION and every
// contract read refetches.
export const CloseContractDialog: React.FC<{
  contractId: string;
  code: string;
  version: number;
  onClose: () => void;
  onClosed?: () => void;
}> = ({ contractId, code, version, onClose, onClosed }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(contractId) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.balance(contractId) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.all }),
    ]);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await closeContract(contractId, version);
      await refresh();
      showToast(`${code} closed.`);
      onClosed?.();
      onClose();
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'BALANCE_OUTSTANDING') {
        setError('This cannot be done while it has open balances. Settle the invoices first.');
      } else if (failure instanceof ApiError && failure.errorCode === 'OPEN_INCIDENTS') {
        setError('This cannot be done while it has open incidents.');
      } else {
        setError(failure instanceof ApiError ? failure.message : messageOf(failure));
      }
      // Whatever refused it, the blockers and the version are read again.
      void refresh();
    }
  };

  return (
    <ConfirmDialog
      titleId="close-title"
      title={`Close contract ${code}?`}
      description="Holder labels are erased. A closed contract cannot be reopened."
      confirmLabel="Close contract"
      pending={pending}
      error={error ?? undefined}
      onConfirm={() => void submit()}
      onCancel={onClose}
    />
  );
};
