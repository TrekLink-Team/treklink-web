import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../shared/api/apiClient';
import { landingRoute, useSession } from '../entities/session/model';
import { signIn } from '../features/sign-in/api';

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
  // The banner a page leaves after sending the user here, such as "Password changed" after a reset.
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const storeSession = useSession((state) => state.signIn);

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
    <div className="flex justify-center py-10">
      <form
        onSubmit={submit}
        noValidate
        aria-labelledby="sign-in-title"
        className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-7 flex flex-col gap-4"
      >
        <h1 id="sign-in-title" className="text-2xl font-bold text-slate-900">
          Sign in
        </h1>

        {notice && !error && (
          <div
            role="status"
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2.5 text-sm text-blue-900"
          >
            {notice}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-in-email" className="text-sm font-semibold text-slate-900">
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
            className="h-11 rounded-lg border border-slate-400 px-3"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-in-password" className="text-sm font-semibold text-slate-900">
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
              className="h-11 min-w-0 flex-1 rounded-lg border border-slate-400 px-3"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="h-11 rounded-lg border border-slate-400 px-3 text-sm font-semibold text-blue-700"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending || email === '' || password === ''}
          className="h-12 rounded-lg bg-blue-700 font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <Link to="/forgot" className="self-start text-sm font-semibold text-blue-700">
          Forgot password?
        </Link>
        <Link to="/register" className="self-start text-sm font-semibold text-blue-700">
          Register your organization
        </Link>
      </form>
    </div>
  );
};
