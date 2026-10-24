import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CODE_SENT_NOTICE, forgotPassword } from '../features/password/api';
import { Notice, TextField } from '../features/password/fields';
import { CARD, errorsFrom, LINK, PRIMARY } from '../features/password/form';

// /forgot, screen 2.1 (specs/frontend/ui-design/2-1-sign-in-forgot-reset-welcome-set.md). The answer
// is the same whether or not the email is registered (auth api-design 05).
export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (failure) {
      setError(errorsFrom(failure).form);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex justify-center py-10">
      <form onSubmit={submit} noValidate aria-labelledby="forgot-title" className={CARD}>
        <h1 id="forgot-title" className="text-2xl font-bold text-slate-900">
          Forgot password
        </h1>

        {sent && (
          <Notice tone="info">
            {CODE_SENT_NOTICE}{' '}
            <Link to="/reset" state={{ email }} className="font-semibold underline">
              I have a code: enter it
            </Link>
          </Notice>
        )}

        <TextField
          id="forgot-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={setEmail}
        />

        <button type="submit" disabled={pending || email === ''} className={PRIMARY}>
          {pending ? 'Sending…' : 'Send code'}
        </button>
        {error && <Notice tone="error">{error}</Notice>}

        <Link to="/sign-in" className={LINK}>
          Back to sign in
        </Link>
      </form>
    </div>
  );
};
