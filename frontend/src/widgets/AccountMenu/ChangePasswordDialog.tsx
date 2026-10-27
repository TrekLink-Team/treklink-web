import React, { useEffect, useRef, useState } from 'react';
import { changePassword } from '../../features/account-menu/api';
import { Notice, PasswordField } from '../../features/password/fields';
import {
  errorsFrom,
  type FormErrors,
  PASSWORDS_DIFFER,
  PRIMARY,
} from '../../features/password/form';
import { DISCARD_PROMPT } from './labels';

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

const FOCUSABLE = 'input, button:not([disabled])';

// Screen 2.2: the change-password dialog (auth api-design 08). It traps focus, starts on Current
// password, and asks before closing over filled fields (chapter 06 §8.7). A failed submit keeps
// every field.
export const ChangePasswordDialog: React.FC<Props> = ({ onClose, onChanged }) => {
  const dialog = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.getElementById('change-current')?.focus();
  }, []);

  const close = () => {
    const filled = current !== '' || password !== '' || confirm !== '';
    if (!filled || window.confirm(DISCARD_PROMPT)) onClose();
  };

  const keepFocusInside = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
    <div className="fixed inset-x-0 bottom-0 top-[var(--tl-banner-h,0px)] z-dialog flex items-center justify-center bg-scrim/[var(--tl-scrim-alpha)] sm:p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-title"
        onKeyDown={keepFocusInside}
        className="h-full w-full overflow-y-auto bg-surface p-6 text-ink shadow-overlay sm:h-auto sm:max-w-sm sm:rounded-sheet sm:border sm:border-line"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <h2 id="change-title" className="text-title text-ink">
            Change password
          </h2>
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

          <div className="flex gap-3">
            <button type="submit" disabled={pending || !filled} className={`${PRIMARY} flex-1`}>
              {pending ? 'Changing…' : 'Change'}
            </button>
            <button
              type="button"
              onClick={close}
              className="h-12 flex-1 rounded-lg border border-slate-400 font-semibold text-slate-900"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
