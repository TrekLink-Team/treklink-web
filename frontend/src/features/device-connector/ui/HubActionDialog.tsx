import React, { useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field, Input } from '../../../shared/ui/Field';
import { ALERT, WARNING } from '../../../shared/ui/styles';
import { contractLine, typedMatches, type HubConfirm } from '../model/hubActions';

/**
 * The confirmation of a hub action (devices design section 12.14, screen 4.7): what the action does, and for a
 * RESERVED or RENTED unit the contract and organization it is on with a field to type the asset tag, the confirm
 * button disabled until it matches. A RETURNED unit still in custody gets the custody note without the field.
 * `onConfirm` receives the typed asset tag, which the start of the hub action record sends (api-design 33).
 */
export const HubActionDialog: React.FC<{
  id: string;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  confirm: HubConfirm | null;
  pending?: boolean;
  error?: string | null;
  onConfirm: (confirmAssetTag: string | undefined) => void;
  onClose: () => void;
  children?: React.ReactNode;
}> = ({ id, title, confirmLabel, danger = false, confirm, pending = false, error, onConfirm, onClose, children }) => {
  const [typed, setTyped] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const needsTag = confirm?.typed === true;
  const matches = !needsTag || typedMatches(typed, confirm.assetTag);
  return (
    <Dialog
      titleId={`${id}-title`}
      title={title}
      onClose={() => (pending ? undefined : onClose())}
      role="alertdialog"
      initialFocus={needsTag ? field : cancel}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button ref={cancel} variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            disabled={!matches}
            onClick={() => onConfirm(needsTag ? typed.trim() : undefined)}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {confirm && (
        <p className={`${WARNING} mb-3`}>
          {contractLine(confirm)}{' '}
          {confirm.typed
            ? 'The organization is using it; check with them before you change it.'
            : 'This is not recorded as the reset of the return while the unit is in custody.'}
        </p>
      )}
      {children}
      {needsTag && (
        <Field id={`${id}-typed`} label={`Type ${confirm.assetTag} to confirm`} className="mt-3">
          <Input
            ref={field}
            id={`${id}-typed`}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={hintId}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
      )}
      {needsTag && (
        <p id={hintId} className="sr-only">
          The confirm button is enabled once the asset tag matches.
        </p>
      )}
      {error && (
        <p role="alert" className={`${ALERT} mt-3`}>
          {error}
        </p>
      )}
    </Dialog>
  );
};
