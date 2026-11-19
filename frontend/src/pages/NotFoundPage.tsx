import React from 'react';
import { Link } from 'react-router-dom';
import { landingRoute, useSession } from '../entities/session/model';
import { LINK } from '../shared/ui/styles';

// An address that matches no route (#516). It said "You do not have access to this." before, which is
// MSG26 for a record or a role the user may not reach (REQ-ERR-01) and wrong for a mistyped address. The
// link gives the way out the no-access page gives: the role's landing route, or the public start page.
export const NotFoundPage: React.FC = () => {
  const user = useSession((state) => state.user);
  const home = user ? landingRoute(null, user) : '/';
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <h1 tabIndex={-1} className="text-title-lg text-ink outline-none">
        Page not found
      </h1>
      <p className="text-lg font-semibold text-ink">This address does not match a page.</p>
      <Link to={home} className={`${LINK} inline-flex min-h-6 items-center`}>
        Go to the start page
      </Link>
    </div>
  );
};
