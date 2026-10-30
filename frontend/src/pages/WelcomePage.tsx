import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { landingRoute, useSession } from '../entities/session/model';
import { setPassword as acceptInvitation } from '../features/password/api';
import { Notice, PasswordField, TextField } from '../features/password/fields';
import {
  CARD,
  errorsFrom,
  type FormErrors,
  LINK,
  PASSWORDS_DIFFER,
  PRIMARY,
} from '../features/password/form';

// /welcome, screen 2.1: an invited account sets its first password and is signed in (auth
// api-design 07). An expired invitation is renewed from /forgot (D-059 rule 6).
export const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const storeSession = useSession((state) => state.signIn);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
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
      const { user, ...tokens } = await acceptInvitation({ email, code, password });
      storeSession(tokens, user);
      navigate(landingRoute(params.get('next'), user), { replace: true });
    } catch (failure) {
      setErrors(errorsFrom(failure));
      setPending(false);
    }
  };

  const filled = email !== '' && code !== '' && password !== '' && confirm !== '';

  return (
    <div className="flex justify-center py-10">
      <form onSubmit={submit} noValidate aria-labelledby="welcome-title" className={CARD}>
        <h1 id="welcome-title" className="text-2xl font-bold text-ink">
          Welcome to TrekLink
        </h1>

        {errors.form && <Notice tone="error">{errors.form}</Notice>}

        <TextField
          id="welcome-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={setEmail}
        />
        <TextField
          id="welcome-code"
          label="Invitation code"
          autoComplete="one-time-code"
          value={code}
          onChange={setCode}
          error={errors.code}
        />
        {errors.code && (
          <Link to="/forgot" className={LINK}>
            Request a new one
          </Link>
        )}
        <PasswordField
          id="welcome-password"
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />
        <PasswordField
          id="welcome-confirm"
          label="Confirm password"
          autoComplete="new-password"
          toggle={false}
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
        />

        <button type="submit" disabled={pending || !filled} className={PRIMARY}>
          {pending ? 'Setting password…' : 'Set password and sign in'}
        </button>
        <Link to="/sign-in" className={LINK}>
          Back to sign in
        </Link>
      </form>
    </div>
  );
};
