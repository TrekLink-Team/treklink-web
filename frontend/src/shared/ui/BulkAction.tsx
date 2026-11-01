import React, { useId, useRef, useState } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Checkbox, Field, Textarea } from './Field';
import { REASON_REQUIRED } from './StateChange';
import { useToast } from './toastStore';
import { runInSequence, type BulkItem, type BulkOutcome } from './bulkSequence';

// A bulk action of the data table rules (specs/frontend/ui-design/0-ui-standard.md §2): the single-row
// endpoint run once per selected row, one after another, never a bulk endpoint the API does not have.
// One dialog holds the three steps: the confirmation titled with the count, the progress, then the
// summary of every row (succeeded, or failed with the server's reason). A row that fails never stops
// the rows after it.

export interface BulkActionDialogProps {
  /** Verb plus count and noun, as a question: "Retire 3 devices?". */
  title: string;
  /** The confirm button: "Retire 3 devices". */
  confirmLabel: string;
  /** The consequences. */
  description?: string;
  destructive?: boolean;
  /** One reason for every row, kept in each row's audit record. */
  needsReason?: boolean;
  reasonHint?: string;
  /** Steps the user confirms were done on every row, each a required checkbox (a reset's wipe steps). */
  confirmations?: readonly string[];
  items: readonly BulkItem[];
  run: (item: BulkItem, reason: string | undefined) => Promise<unknown>;
  /** After the run, before the summary shows: refetch the list here. */
  onFinished?: (outcomes: BulkOutcome[]) => void;
  onClose: () => void;
}

/** The confirmation, the sequence and its per-row summary. */
export const BulkActionDialog: React.FC<BulkActionDialogProps> = ({
  title,
  confirmLabel,
  description,
  destructive,
  needsReason,
  reasonHint,
  confirmations = [],
  items,
  run,
  onFinished,
  onClose,
}) => {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const reasonId = `${baseId}-reason`;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const showToast = useToast((state) => state.show);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<BulkOutcome[] | null>(null);
  const running = done !== null && outcomes === null;

  const start = async () => {
    const trimmed = reason.trim();
    if (needsReason && trimmed === '') {
      setReasonError(REASON_REQUIRED);
      reasonRef.current?.focus();
      return;
    }
    setReasonError(undefined);
    if (confirmations.some((step) => !ticked.has(step))) {
      setStepsError('Tick every step for every selected row first.');
      return;
    }
    setStepsError(null);
    setDone(0);
    const result = await runInSequence(items, (item) => run(item, trimmed || undefined), setDone);
    onFinished?.(result);
    const failed = result.filter((outcome) => !outcome.ok).length;
    if (failed === 0) {
      showToast(`${result.length} of ${result.length} done.`, { tone: 'success' });
      onClose();
      return;
    }
    setOutcomes(result);
  };

  if (outcomes) {
    const succeeded = outcomes.filter((outcome) => outcome.ok);
    const failed = outcomes.filter((outcome) => !outcome.ok);
    return (
      <Dialog
        titleId={titleId}
        title={`${succeeded.length} of ${outcomes.length} done`}
        description={`${failed.length} could not be changed. The others are saved.`}
        onClose={onClose}
        size="md"
        footer={
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Alert tone="warning" title={`${failed.length} failed`}>
            <ul className="flex flex-col gap-1">
              {failed.map((outcome) => (
                <li key={outcome.id}>
                  <span className="font-semibold">{outcome.label}</span>: {outcome.reason}
                </li>
              ))}
            </ul>
          </Alert>
          {succeeded.length > 0 && (
            <div>
              <h3 className="text-body-sm font-semibold text-ink">Succeeded</h3>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-body-sm text-ink-muted">
                {succeeded.map((outcome) => (
                  <li key={outcome.id}>{outcome.label}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      titleId={titleId}
      title={title}
      description={description}
      role={destructive ? 'alertdialog' : 'dialog'}
      initialFocus={needsReason ? reasonRef : destructive ? cancelRef : undefined}
      onClose={running ? () => undefined : onClose}
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={running}
            loadingLabel={`${done ?? 0} of ${items.length}`}
            onClick={() => void start()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ul aria-label="Selected" className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-auto text-body-sm text-ink-muted">
          {items.map((item) => (
            <li key={item.id}>{item.label}</li>
          ))}
        </ul>
        {confirmations.length > 0 && (
          <fieldset className="flex flex-col">
            <legend className="text-body-sm font-semibold text-ink">Done on every selected row</legend>
            {confirmations.map((step) => (
              <Checkbox
                key={step}
                label={step}
                checked={ticked.has(step)}
                onChange={(event) =>
                  setTicked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(step);
                    else next.delete(step);
                    return next;
                  })
                }
              />
            ))}
            {stepsError && (
              <Alert tone="error" className="mt-2">
                {stepsError}
              </Alert>
            )}
          </fieldset>
        )}
        {needsReason && (
          <Field id={reasonId} label="Reason" required hint={reasonHint ?? 'Kept in the audit log of every row.'} error={reasonError}>
            <Textarea
              ref={reasonRef}
              id={reasonId}
              rows={3}
              value={reason}
              invalid={Boolean(reasonError)}
              aria-describedby={reasonError ? `${reasonId}-error` : `${reasonId}-hint`}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {running ? `${done} of ${items.length} done` : ''}
        </div>
      </div>
    </Dialog>
  );
};
