import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { landingRoute } from '../entities/session/model';

// `/` until the public plans page (screen 2.3) is built: a signed-in user goes to their landing
// route, where the live map or the organization dashboard shows real numbers; a visitor goes to
// sign-in. The interim dashboard with fixed tiles and a fixed gateway badge is gone, because none of
// its numbers had a source.
export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  return <Navigate to={user ? landingRoute(null, user) : '/sign-in'} replace />;
};
