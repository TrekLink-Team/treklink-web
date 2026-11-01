import React, { useId, useState } from 'react';
import { ConfirmDialog } from './Dialog';

export interface ConfirmStep {
  title: string;
  /** What happens, and whether it can be undone. */
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
}

/**
 * A confirmation asked in a `ConfirmDialog` over the current dialog, never `window.confirm` (UI
 * standard §3, AGENTS frontend rules). `ask` opens it and runs `then` on confirm; render `dialog`
 * next to the dialog that asks. Cancel, the least destructive control, gets focus first, and focus
 * returns to the control that asked.
 */
export const useConfirmStep = () => {
  const titleId = useId();
  const [asked, setAsked] = useState<(ConfirmStep & { then: () => void }) | null>(null);
  const ask = (step: ConfirmStep, then: () => void) => setAsked({ ...step, then });
  const dialog = asked ? (
    <ConfirmDialog
      titleId={titleId}
      title={asked.title}
      description={asked.description}
      confirmLabel={asked.confirmLabel}
      cancelLabel={asked.cancelLabel ?? 'Keep editing'}
      destructive
      onConfirm={() => {
        const { then } = asked;
        setAsked(null);
        then();
      }}
      onCancel={() => setAsked(null)}
    />
  ) : null;
  return { ask, dialog };
};
