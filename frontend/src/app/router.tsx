import React from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { landingRoute } from '../entities/session/model';
import { DashboardPage } from '../pages/DashboardPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { NoAccessPage } from '../pages/NoAccessPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SignInPage } from '../pages/SignInPage';
import { WelcomePage } from '../pages/WelcomePage';
import { hasAnyRole, type Role } from '../shared/lib/permissions';
import { useAuth } from './providers/useAuth';

// Sends an anonymous visitor to sign-in and back to the page they asked for (design §2, `?next=`).
export const RequireAuth: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return <Outlet />;
};

// The sign-in, forgot, reset and welcome pages are for visitors; a signed-in user is sent to their
// landing route (screen 2.1).
export const SignedOutOnly: React.FC = () => {
  const { user } = useAuth();
  return user ? <Navigate to={landingRoute(null, user)} replace /> : <Outlet />;
};

// A route shows only when the role holds it. This is a convenience: the server refuses the data
// either way (REQ-UBI-01).
export const RequireRole: React.FC<{ roles: readonly Role[] }> = ({ roles }) => {
  const { user } = useAuth();
  return user && hasAnyRole(user.roles, roles) ? <Outlet /> : <NoAccessPage />;
};

const ORG_OPERATOR: Role[] = ['ORG_OPERATOR'];
const STAFF: Role[] = ['STAFF'];

// Routes of specs/frontend/design.md §2. Only built pages are registered; the rest of the table is
// added with the task that builds each page. The map routes show the interim dashboard until
// `LiveMapPage` (task 9.1), and `/o/contracts`, the Org Manager's landing route, until task 5.1.
export const AppRoutes: React.FC = () => (
  <Routes>
    <Route path="/" element={<DashboardPage />} />
    <Route element={<SignedOutOnly />}>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/forgot" element={<ForgotPasswordPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
    </Route>
    <Route element={<RequireAuth />}>
      <Route element={<RequireRole roles={ORG_OPERATOR} />}>
        <Route path="/o/map" element={<DashboardPage />} />
        <Route path="/o/contracts" element={<DashboardPage />} />
      </Route>
      <Route element={<RequireRole roles={STAFF} />}>
        <Route path="/t/map" element={<DashboardPage />} />
      </Route>
    </Route>
    <Route path="*" element={<NoAccessPage />} />
  </Routes>
);
