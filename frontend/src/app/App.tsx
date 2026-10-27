import React from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { landingRoute } from '../entities/session/model';
import { Toast } from '../shared/ui/toast';
import { AppShell } from '../widgets/AppShell/AppShell';
import { AuthLayout } from '../widgets/AppShell/AuthLayout';
import { AlertBanner } from './AlertBanner';
import { AuthProvider } from './providers/AuthProvider';
import { LiveProvider } from './providers/LiveProvider';
import { useAuth } from './providers/useAuth';
import { AppRoutes } from './router';

const AUTH_PATHS = ['/sign-in', '/forgot', '/reset', '/welcome'];

// Signed in: the app shell with the incident banner on top. Signed out: the minimal auth layout.
// The routes and their guards stay in router.tsx.
const Frame: React.FC = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user || AUTH_PATHS.includes(pathname)) {
    return (
      <AuthLayout wide={!AUTH_PATHS.includes(pathname)}>
        <AppRoutes />
      </AuthLayout>
    );
  }
  return (
    <AppShell user={user} home={landingRoute(null, user)} banner={<AlertBanner />}>
      <AppRoutes />
    </AppShell>
  );
};

export const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <LiveProvider>
        <Frame />
        <Toast />
      </LiveProvider>
    </AuthProvider>
  </BrowserRouter>
);
