import React from 'react';
import { Loader2 } from 'lucide-react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { landingRoute, useSession } from '../entities/session/model';
import { Toast } from '../shared/ui/toast';
import { AppShell } from '../widgets/AppShell/AppShell';
import { AuthLayout } from '../widgets/AppShell/AuthLayout';
import { AlertBanner } from './AlertBanner';
import { AuthProvider } from './providers/AuthProvider';
import { LiveProvider } from './providers/LiveProvider';
import { useAuth } from './providers/useAuth';
import { AppRoutes } from './router';

const AUTH_PATHS = ['/sign-in', '/forgot', '/reset', '/welcome'];
// Single-form pages in the narrow frame. /sign-in takes the wide frame so the sandbox test accounts box
// can sit beside its form (screen 7.5 box, D-089); the form keeps its own width either way.
const NARROW_PATHS = ['/forgot', '/reset', '/welcome'];

// Signed in: the app shell with the incident banner on top. Signed out: the minimal auth layout.
// The routes and their guards stay in router.tsx.
const Frame: React.FC = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user || AUTH_PATHS.includes(pathname)) {
    return (
      <AuthLayout wide={!NARROW_PATHS.includes(pathname)}>
        <AppRoutes />
      </AuthLayout>
    );
  }
  return (
    <AppShell
      user={user}
      home={landingRoute(null, user)}
      banner={<AlertBanner staff={user.accountType === 'TREKLINK'} />}
    >
      <AppRoutes />
    </AppShell>
  );
};

// While a reload's stored session is being restored (D-090 rule 3), nothing routes yet, so the guards
// cannot send a returning user to sign-in before the refresh answers.
export const App: React.FC = () => {
  const restoring = useSession((state) => state.restoring);
  // A cold backend can take a few seconds to answer the refresh, so the wait is visible.
  if (restoring) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <p className="flex items-center gap-2 text-body text-ink-muted">
          <Loader2 aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />
          Restoring your session
        </p>
      </div>
    );
  }
  return (
    <BrowserRouter>
      <AuthProvider>
        <LiveProvider>
          <Frame />
          <Toast />
        </LiveProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};
