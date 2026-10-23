import React from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';
import { NoAccessPage } from '../pages/NoAccessPage';
import { SignInPage } from '../pages/SignInPage';
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
    <Route path="/sign-in" element={<SignInPage />} />
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
