import React, { Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { landingRoute, useSession } from '../entities/session/model';
import { BillingPage } from '../pages/BillingPage';
import { ContractApprovalPage } from '../pages/ContractApprovalPage';
import { ContractDetailPage } from '../pages/ContractDetailPage';
import { ContractRequestPage } from '../pages/ContractRequestPage';
import { ContractsPage } from '../pages/ContractsPage';
import { CounterPage } from '../pages/CounterPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { IncidentDetailPage } from '../pages/IncidentDetailPage';
import { IncidentsPage } from '../pages/IncidentsPage';
import { StaffIncidentsPage } from '../pages/StaffIncidentsPage';
import { InvoiceDetailPage, InvoicesPage } from '../pages/InvoicesPage';
import { PaymentPage } from '../pages/PaymentPage';
import { PricesPage } from '../pages/PricesPage';
import { NoAccessPage } from '../pages/NoAccessPage';
import { OrgDashboardPage } from '../pages/OrgDashboardPage';
import { OrganizationReviewPage } from '../pages/OrganizationReviewPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SignInPage } from '../pages/SignInPage';
import { WelcomePage } from '../pages/WelcomePage';
import { hasAnyRole, type Role } from '../shared/lib/permissions';
import { useAuth } from './providers/useAuth';

// Development only: the design system page (docs/design-system.md). Vite drops the import from a
// production build because the route below is behind import.meta.env.DEV.
const loadDesignSystem = () =>
  import('../pages/DesignSystemPage').then((module) => ({ default: module.DesignSystemPage }));
const DesignSystemPage = import.meta.env.DEV ? React.lazy(loadDesignSystem) : null;

// Sends an anonymous visitor to sign-in and back to the page they asked for (design §2, `?next=`).
// After Sign out it renders nothing: the session ends at once but the router's navigation is a
// transition, so this guard would otherwise run first and send the next user to the old page.
export const RequireAuth: React.FC = () => {
  const { user } = useAuth();
  const signedOutByUser = useSession((state) => state.signedOutByUser);
  const location = useLocation();
  if (!user && signedOutByUser) return null;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return <Outlet />;
};

// The sign-in, forgot, reset and welcome pages are for visitors; a signed-in user is sent to their
// landing route (screen 2.1). A same-origin `?next=` wins here too: the sign-in page stores the
// session before it navigates, so this guard renders first and would otherwise drop `next`.
export const SignedOutOnly: React.FC = () => {
  const { user } = useAuth();
  const next = new URLSearchParams(useLocation().search).get('next');
  return user ? <Navigate to={landingRoute(next, user)} replace /> : <Outlet />;
};

// A route shows only when the role holds it. This is a convenience: the server refuses the data
// either way (REQ-UBI-01).
export const RequireRole: React.FC<{ roles: readonly Role[] }> = ({ roles }) => {
  const { user } = useAuth();
  return user && hasAnyRole(user.roles, roles) ? <Outlet /> : <NoAccessPage />;
};

const ORG_OPERATOR: Role[] = ['ORG_OPERATOR'];
const ORG_MANAGER: Role[] = ['ORG_MANAGER'];
const ADMIN: Role[] = ['ADMIN'];
const STAFF: Role[] = ['STAFF'];

// Routes of specs/frontend/design.md §2. Only built pages are registered; the rest of the table is
// added with the task that builds each page. The map routes show the interim dashboard until
// `LiveMapPage` (task 9.1). Contracts and billing are screens 5.1 to 5.4 and 6.1 to 6.4.
export const AppRoutes: React.FC = () => (
  <Routes>
    <Route path="/" element={<DashboardPage />} />
    <Route element={<SignedOutOnly />}>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/forgot" element={<ForgotPasswordPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/register" element={<RegisterPage />} />
    </Route>
    <Route element={<RequireAuth />}>
      <Route element={<RequireRole roles={ORG_OPERATOR} />}>
        <Route path="/o/map" element={<DashboardPage />} />
        <Route path="/o/incidents" element={<IncidentsPage />} />
        <Route path="/o/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/o/contracts" element={<ContractsPage />} />
        <Route path="/o/contracts/:id" element={<ContractDetailPage scope="o" />} />
      </Route>
      <Route element={<RequireRole roles={ORG_MANAGER} />}>
        <Route path="/o" element={<OrgDashboardPage />} />
        <Route path="/o/contracts/new" element={<ContractRequestPage />} />
        <Route path="/o/invoices" element={<InvoicesPage />} />
        <Route path="/o/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/o/pay/:paymentId" element={<PaymentPage />} />
      </Route>
      <Route element={<RequireRole roles={STAFF} />}>
        <Route path="/t/map" element={<DashboardPage />} />
        <Route path="/t/incidents" element={<StaffIncidentsPage />} />
        <Route path="/t/contracts" element={<ContractApprovalPage />} />
        <Route path="/t/contracts/:id" element={<ContractDetailPage scope="t" />} />
        <Route path="/t/billing" element={<BillingPage />} />
        <Route path="/t/organizations" element={<OrganizationReviewPage />} />
        <Route path="/t/counter/:contractId" element={<CounterPage />} />
      </Route>
      <Route element={<RequireRole roles={ADMIN} />}>
        <Route path="/t/admin/prices" element={<PricesPage />} />
      </Route>
    </Route>
    {DesignSystemPage && (
      <Route
        path="/dev/design-system"
        element={
          <Suspense fallback={null}>
            <DesignSystemPage />
          </Suspense>
        }
      />
    )}
    <Route path="*" element={<NoAccessPage />} />
  </Routes>
);
