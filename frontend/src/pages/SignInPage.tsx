import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../shared/api/apiClient';
import { useDemoAccounts, type DemoTestAccount } from '../entities/demo/api';
import { landingRoute, useSession } from '../entities/session/model';
import { signIn } from '../features/sign-in/api';
import { CARD, LINK, PRIMARY } from '../features/password/form';
import { Alert } from '../shared/ui/Alert';
import { FOCUS } from '../shared/ui/styles';
import { TestAccountsBox } from '../widgets/TestAccountsBox/TestAccountsBox';

// MSG09 for wrong credentials; any other failure shows the server message (screen 2.1).
const GENERIC_FAILURE = 'Sign-in failed. Please try again.';

// /sign-in, screen 2.1 (specs/frontend/ui-design/2-1-sign-in-forgot-reset-welcome-set.md).
export const SignInPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // The banner a page leaves after sending the user here, such as "Password changed" after a reset, and
  // the test account chosen on `/` (screen 7.5 box): its email only, never its password.
  const state = useLocation().state as { notice?: string; demoEmail?: string } | null;
  const notice = state?.notice;
  const storeSession = useSession((session) => session.signIn);
  const submitRef = useRef<HTMLButtonElement>(null);
  const accounts = useDemoAccounts();
  const [preselected, setPreselected] = useState(false);

  const focusSubmit = useRef(false);

  const applyAccount = (account: DemoTestAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
    focusSubmit.current = true;
  };

  // After Use, focus moves to Sign in once the filled fields have enabled it.
  useEffect(() => {
    if (!focusSubmit.current) return;
    focusSubmit.current = false;
    submitRef.current?.focus();
  });

  // The account chosen on `/` is filled once, from this page's own copy of the list, while rendering
  // (React's pattern for state derived from a prop), so the first paint after the list loads shows it.
  if (!preselected && state?.demoEmail && accounts.data) {
    setPreselected(true);
    const account = accounts.data.find((candidate) => candidate.email === state.demoEmail);
    if (account) {
      setEmail(account.email);
      setPassword(account.password);
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { user, ...tokens } = await signIn({ email, password });
      storeSession(tokens, user);
      navigate(landingRoute(params.get('next'), user), { replace: true });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-start justify-center gap-6 py-10">
      <form
        onSubmit={submit}
        noValidate
        aria-labelledby="sign-in-title"
        className={CARD}
      >
        <h1 id="sign-in-title" className="text-2xl font-bold text-ink">
          Sign in
        </h1>

        {notice && !error && (
          <Alert tone="info">{notice}</Alert>
        )}

        {error && (
          <Alert tone="error">{error}</Alert>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-in-email" className="text-sm font-semibold text-ink">
            Email
          </label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={`h-11 rounded-lg border border-line-strong px-3 bg-surface text-ink ${FOCUS}`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-in-password" className="text-sm font-semibold text-ink">
            Password
          </label>
          <div className="flex gap-2">
            <input
              id="sign-in-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`h-11 min-w-0 flex-1 rounded-lg border border-line-strong px-3 bg-surface text-ink ${FOCUS}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className={`h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-brand ${FOCUS}`}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button
          ref={submitRef}
          type="submit"
          disabled={pending || email === '' || password === ''}
          className={PRIMARY}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <Link to="/forgot" className={LINK}>
          Forgot password?
        </Link>
        {/* An invited account sets its first password on /welcome with the emailed code. */}
        <Link to="/welcome" className={LINK}>
          Set password
        </Link>
        <Link to="/register" className={LINK}>
          Register your organization
        </Link>
      </form>
      <TestAccountsBox onUse={applyAccount} className="w-full max-w-xl lg:w-auto lg:flex-1" />
    </div>
  );
};
