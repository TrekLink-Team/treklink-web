import React from 'react';
import { Link } from 'react-router-dom';
import { landingRoute, useSession } from '../entities/session/model';
import { LINK } from '../shared/ui/styles';

// MSG26, shown for a route the role does not hold and for an unknown path (REQ-ERR-01). The link
// below it gives a way out of a mistyped address, which outside the app shell had none (W15 panel
// walk): the role's landing route when signed in, the public start page otherwise. It sits outside
// the alert, so the alert reads MSG26 alone. The h1 above it names the page, so it has a heading like
// the 403 and 404 state of the organization page (#441).
export const NoAccessPage: React.FC = () => {
  const user = useSession((state) => state.user);
  const home = user ? landingRoute(null, user) : '/';
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <h1 tabIndex={-1} className="text-title-lg text-ink outline-none">
        No access
      </h1>
      <p role="alert" className="text-lg font-semibold text-ink">
        You do not have access to this.
      </p>
      <Link to={home} className={`${LINK} inline-flex min-h-6 items-center`}>
        Go to the start page
      </Link>
    </div>
  );
};
