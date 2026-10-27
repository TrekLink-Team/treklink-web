import React from 'react';
import { useLocation } from 'react-router-dom';
import type { NavGroup } from '../../shared/config/navigation';
import { Breadcrumb } from '../../shared/ui/PageHeader';
import { crumbsFor } from './crumbs';

export const ShellBreadcrumb: React.FC<{ groups: NavGroup[]; workspace: string }> = ({ groups, workspace }) => {
  const { pathname } = useLocation();
  const crumbs = crumbsFor(groups, pathname, workspace);
  return crumbs.length ? <Breadcrumb items={crumbs} className="mb-1" /> : null;
};
