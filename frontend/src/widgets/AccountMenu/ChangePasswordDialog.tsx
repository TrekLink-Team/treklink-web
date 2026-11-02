import React, { useState } from 'react';
import { changePassword } from '../../features/account-menu/api';
import { Notice, PasswordField } from '../../features/password/fields';
import {
  errorsFrom,
  type FormErrors,
  PASSWORDS_DIFFER,
} from '../../features/password/form';
import { Button, Dialog } from '../../shared/ui';
import { useConfirmStep } from '../../shared/ui/useConfirmStep';
import { DISCARD_PROMPT } from './labels';

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

const FORM_ID = 'change-password-form';

// Screen 2.2: the change-password dialog (auth api-design 08), a `Dialog`. It starts on Current
// password and asks in a `ConfirmDialog` before closing over filled fields (chapter 06 §8.7). A failed
// submit keeps every field.
export const ChangePasswordDialog: React.FC<Props> = ({ onClose, onChanged }) => {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
  const discard = useConfirmStep();

  const close = () => {
    const touched = current !== '' || password !== '' || confirm !== '';
    if (!touched) onClose();
    else
      discard.ask(
        {
          title: DISCARD_PROMPT,
          description: 'The password stays as it is.',
          confirmLabel: 'Discard',
        },
        onClose,
      );
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirm !== password) {
      setErrors({ confirm: PASSWORDS_DIFFER });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await changePassword({ currentPassword: current, newPassword: password });
      onChanged();
    } catch (failure) {
      setErrors(errorsFrom(failure));
      setPending(false);
    }
  };

  const filled = current !== '' && password !== '' && confirm !== '';

  return (
    <>
      <Dialog
        titleId="change-title"
        title="Change password"
        size="sm"
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              variant="primary"
              loading={pending}
              loadingLabel="Changing…"
              disabled={!filled}
            >
              Change
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
          {errors.form && <Notice tone="error">{errors.form}</Notice>}

          <PasswordField
            id="change-current"
            label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            error={errors.current}
          />
          <PasswordField
            id="change-password"
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            error={errors.password}
          />
          <PasswordField
            id="change-confirm"
            label="Confirm new password"
            autoComplete="new-password"
            toggle={false}
            value={confirm}
            onChange={setConfirm}
            error={errors.confirm}
          />
        </form>
      </Dialog>
      {discard.dialog}
    </>
  );
};
