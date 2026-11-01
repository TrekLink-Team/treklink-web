import React, { useId, useRef, useState } from 'react';
import { ApiError } from '../api/apiClient';
import { Alert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { messageOf } from './errors';
import { Field, Textarea } from './Field';
import { Menu } from './Menu';
import { useToast } from './toastStore';

// A lifecycle change of one record (specs/frontend/ui-design/0-ui-standard.md §3): a menu of only the
// next states the page allows, a confirmation named after the action with the consequences in the
// body, an optional required reason, `expectedVersion` on the request, a toast after success, and a
// persistent conflict notice on STALE_VERSION that keeps what the user typed. The server re-checks
// every transition; the menu is a convenience, never the authority.

export const MSG03 = 'Saved.';
export const MSG36 = 'Someone else changed this. Reload to see the latest.';
export const REASON_REQUIRED = 'Enter a reason for this change.';

export interface StateTransition<S extends string = string> {
  /** The state the record moves to. */
  target: S;
  /** Verb plus noun: "Retire device". Names the menu item, the dialog title and the confirm button. */
  label: string;
  /** Cannot be undone or takes something away: an alert dialog, Cancel focused first, a danger button. */
  destructive?: boolean;
  /** The change is audited with a reason the user must give. */
  needsReason?: boolean;
  /** The consequences, shown in the dialog body. */
  description?: string;
  /** Hint under the reason label. */
  reasonHint?: string;
  /** The toast after success. Defaults to MSG03. */
  successMessage?: string;
  /** Label of the button that closes the dialog without changing anything. Defaults to Cancel. */
  cancelLabel?: string;
}

export interface StateChangeInput<S extends string = string> {
  target: S;
  expectedVersion: number;
  reason?: string;
}

export interface StateChangeDialogProps<S extends string = string> {
  /** Names the record: "TL-0042". */
  subject: string;
  transition: StateTransition<S>;
  /** The version the page loaded, sent as `expectedVersion`. */
  version: number;
  onSubmit: (input: StateChangeInput<S>) => Promise<unknown>;
  onClose: () => void;
  /** Refetches the record after a conflict; the dialog stays open with the reason kept. */
  onReload?: () => void;
  /** Called after success, before the dialog closes. */
  onDone?: () => void;
}

const isStale = (error: unknown) => error instanceof ApiError && error.errorCode === 'STALE_VERSION';

/** The confirmation of one transition. */
export function StateChangeDialog<S extends string = string>({
  subject,
  transition,
  version,
  onSubmit,
  onClose,
  onReload,
  onDone,
}: StateChangeDialogProps<S>) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const reasonId = `${baseId}-reason`;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const showToast = useToast((state) => state.show);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    const trimmed = reason.trim();
    if (transition.needsReason && trimmed === '') {
      setReasonError(REASON_REQUIRED);
      reasonRef.current?.focus();
      return;
    }
    setReasonError(undefined);
    setFailure(null);
    setPending(true);
    try {
      await onSubmit({
        target: transition.target,
        expectedVersion: version,
        ...(trimmed !== '' ? { reason: trimmed } : {}),
      });
      showToast(transition.successMessage ?? MSG03, { tone: 'success' });
      onDone?.();
      onClose();
    } catch (error) {
      if (isStale(error)) {
        setStale(true);
      } else {
        setFailure(messageOf(error));
      }
    } finally {
      setPending(false);
    }
  };

  // The least destructive control gets focus: the reason when one is needed (typing changes
  // nothing), otherwise Cancel on a destructive change.
  const initialFocus = transition.needsReason ? reasonRef : transition.destructive ? cancelRef : undefined;

  return (
    <Dialog
      titleId={titleId}
      title={`${transition.label} ${subject}?`}
      description={transition.description}
      role={transition.destructive ? 'alertdialog' : 'dialog'}
      initialFocus={initialFocus}
      onClose={pending ? () => undefined : onClose}
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={pending}>
            {transition.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={transition.destructive ? 'danger' : 'primary'} onClick={() => void confirm()} loading={pending}>
            {transition.label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {stale && (
          <Alert
            tone="warning"
            title="This record changed"
            action={
              onReload ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setStale(false);
                    onReload();
                  }}
                >
                  Reload
                </Button>
              ) : undefined
            }
          >
            {MSG36}
            {transition.needsReason ? ' Your reason is kept.' : ''}
          </Alert>
        )}
        {failure && (
          <Alert tone="error" title="The change was refused">
            {failure}
          </Alert>
        )}
        {transition.needsReason && (
          <Field id={reasonId} label="Reason" required hint={transition.reasonHint ?? 'Kept in the audit log.'} error={reasonError}>
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
      </div>
    </Dialog>
  );
}

export interface StateChangeMenuProps<S extends string = string> {
  subject: string;
  /** Only the transitions allowed from the current state for this user. Empty renders nothing. */
  transitions: StateTransition<S>[];
  version: number;
  onSubmit: (input: StateChangeInput<S>) => Promise<unknown>;
  onReload?: () => void;
  onDone?: () => void;
  /** The menu button text. Its accessible name adds the subject: "Change status of TL-0042". */
  label?: string;
  align?: 'start' | 'end';
}

/** The menu of allowed next states, and the confirmation of the one chosen. */
export function StateChangeMenu<S extends string = string>({
  subject,
  transitions,
  version,
  onSubmit,
  onReload,
  onDone,
  label = 'Change status',
  align = 'end',
}: StateChangeMenuProps<S>) {
  const [chosen, setChosen] = useState<StateTransition<S> | null>(null);
  if (transitions.length === 0) return null;
  return (
    <>
      <Menu
        label={`${label} of ${subject}`}
        align={align}
        triggerClassName="h-11 border border-line-strong bg-surface px-4 text-body"
        trigger={<span>{label}</span>}
        items={transitions.map((transition) => ({
          key: transition.target,
          label: transition.label,
          destructive: transition.destructive,
          onSelect: () => setChosen(transition),
        }))}
      />
      {chosen && (
        <StateChangeDialog
          subject={subject}
          transition={chosen}
          version={version}
          onSubmit={onSubmit}
          onReload={onReload}
          onDone={onDone}
          onClose={() => setChosen(null)}
        />
      )}
    </>
  );
}
