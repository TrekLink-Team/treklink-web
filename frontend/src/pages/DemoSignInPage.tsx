import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageScrollBody } from '../shared/ui/PageChrome';
import { ApiError } from '../shared/api/apiClient';
import { useDemoAccounts, type DemoTestAccount } from '../entities/demo/api';
import { landingRoute, useSession } from '../entities/session/model';
import { signIn } from '../features/sign-in/api';
import { CARD, LINK } from '../features/password/form';
import { Alert } from '../shared/ui/Alert';
import { TestAccountsBox } from '../widgets/TestAccountsBox/TestAccountsBox';

const GENERIC_FAILURE = 'Sign-in failed. Please try again.';
const OFF = 'Demo sign-in is off on this deployment.';
const LOAD_FAILED = 'The demo accounts could not be loaded. Try again.';

// /demo: one-click sign-in as any seeded demo account (leader, 2026-11-13). The list comes from the
// sandbox test accounts read (demo api-design 05), so it exists only while DEMO_TEST_ACCOUNTS_ENABLED
// is true; /sign-in and / stay clean.
export const DemoSignInPage: React.FC = () => {
  const accounts = useDemoAccounts();
  const storeSession = useSession((session) => session.signIn);
  const navigate = useNavigate();
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quickSignIn = async (account: DemoTestAccount) => {
    setError(null);
    setBusyEmail(account.email);
    try {
      const { user, ...tokens } = await signIn({ email: account.email, password: account.password });
      storeSession(tokens, user);
      navigate(landingRoute(null, user), { replace: true });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : GENERIC_FAILURE);
      setBusyEmail(null);
    }
  };

  // A 404 or an empty list means the read is switched off; any other failure is worth a retry.
  const off =
    (accounts.error instanceof ApiError && accounts.error.statusCode === 404) ||
    (accounts.data !== undefined && accounts.data.length === 0);
  const failed = accounts.isError && !off;

  return (
    <div data-fit-page="" className="flex min-h-0 flex-1 flex-col">
      <PageScrollBody
        label="Demo sign-in"
        className="flex flex-col items-center gap-6 py-4 sm:py-10"
      >
        <div className="flex w-full max-w-xl flex-col gap-2">
          <h1 className="text-2xl font-bold text-ink">Demo sign-in</h1>
          {!off && (
            <p className="text-body text-ink-muted">
              Pick an account to sign in at once. Each one is a seeded demo account with fictitious data.
            </p>
          )}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
        {accounts.isPending && (
          <p role="status" className="text-body text-ink-muted">
            Loading demo accounts…
          </p>
        )}
        {failed && (
          <div className={CARD}>
            <Alert tone="error">{LOAD_FAILED}</Alert>
            <button type="button" onClick={() => void accounts.refetch()} className={LINK}>
              Try again
            </button>
          </div>
        )}
        {off && (
          <div className={CARD}>
            <Alert tone="info">{OFF}</Alert>
            <Link to="/sign-in" className={LINK}>
              Go to sign in
            </Link>
          </div>
        )}
        <TestAccountsBox
          onUse={(account) => void quickSignIn(account)}
          actionLabel="Sign in"
          busyEmail={busyEmail}
          className="w-full max-w-xl"
        />
      </PageScrollBody>
    </div>
  );
};
