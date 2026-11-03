// Root wrapper for designs and preview cards built with the TrekLink System in claude.ai/design.
// DataTable rows (rowHref), Breadcrumb and PageHeader render react-router <Link>s, which throw
// outside a router, so everything renders inside an in-memory router here.
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

export const TrekLinkRoot: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>{children}</MemoryRouter>
);
