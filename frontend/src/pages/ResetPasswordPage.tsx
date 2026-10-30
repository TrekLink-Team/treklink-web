import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  CODE_SENT_NOTICE,
  forgotPassword,
  PASSWORD_CHANGED_NOTICE,
  resetPassword,
} from '../features/password/api';
import { Notice, PasswordField, TextField } from '../features/password/fields';
import {
  CARD,
  errorsFrom,
  type FormErrors,
  LINK,
  PASSWORDS_DIFFER,
  PRIMARY,
} from '../features/password/form';

// /reset, screen 2.1. The email arrives from /forgot in router state, never in the URL. On success
// the server ends every session of the account and the user signs in again (auth api-design 06).
export const ResetPasswordPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirm !== password) {
      setErrors({ confirm: PASSWORDS_DIFFER });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await resetPassword({ email, code, newPassword: password });
      navigate('/sign-in', { replace: true, state: { notice: PASSWORD_CHANGED_NOTICE } });
    } catch (failure) {
      setErrors(errorsFrom(failure));
      setPending(false);
    }
  };

  const sendNewCode = async () => {
    setErrors({});
    try {
      await forgotPassword(email);
      setResent(true);
    } catch (failure) {
      setErrors(errorsFrom(failure));
    }
  };

  const filled = email !== '' && code !== '' && password !== '' && confirm !== '';

  return (
    <div className="flex justify-center py-10">
      <form onSubmit={submit} noValidate aria-labelledby="reset-title" className={CARD}>
        <h1 id="reset-title" className="text-2xl font-bold text-ink">
          Reset password
        </h1>

        {resent && <Notice tone="info">{CODE_SENT_NOTICE}</Notice>}
        {errors.form && <Notice tone="error">{errors.form}</Notice>}

        <TextField
          id="reset-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus={email === ''}
          value={email}
          onChange={setEmail}
        />
        <TextField
          id="reset-code"
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={email !== ''}
          value={code}
          onChange={setCode}
          error={errors.code}
        />
        <PasswordField
          id="reset-password"
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />
        <PasswordField
          id="reset-confirm"
          label="Confirm new password"
          autoComplete="new-password"
          toggle={false}
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
        />

        <button type="submit" disabled={pending || !filled} className={PRIMARY}>
          {pending ? 'Resetting…' : 'Reset password'}
        </button>

        <button type="button" onClick={sendNewCode} disabled={email === ''} className={LINK}>
          Send a new code
        </button>
        <Link to="/sign-in" className={LINK}>
          Back to sign in
        </Link>
      </form>
    </div>
  );
};
