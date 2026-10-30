import React from 'react';

// MSG26, shown for a route the role does not hold and for an unknown path (REQ-ERR-01).
export const NoAccessPage: React.FC = () => (
  <div role="alert" className="flex justify-center py-16">
    <p className="text-lg font-semibold text-ink">You do not have access to this.</p>
  </div>
);
