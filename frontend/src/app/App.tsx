import React from 'react';
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
  if (restoring) {
    return (
      <p role="status" className="sr-only">
        Restoring your session
      </p>
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
