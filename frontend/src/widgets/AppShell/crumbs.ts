import { entryForPath, groupForPath, type NavGroup } from '../../shared/config/navigation';
import type { Crumb } from '../../shared/ui/PageHeader';

const DETAIL_LABEL: Record<string, string> = { new: 'New' };

// Pages outside the nav table that belong to another module, with the label of their own crumb: the
// SePay payment page is opened from an invoice, so it sits under Business, Invoices.
const OWNED_BY: Record<string, { route: string; label: string }> = {
  '/o/pay': { route: '/o/invoices', label: 'Payment' },
};

// The breadcrumb every page gets from the shell: workspace, area, module and, below a module, the
// record. Pages outside the nav table pass their own trail to PageHeader instead.
export const crumbsFor = (groups: NavGroup[], path: string, workspace: string): Crumb[] => {
  const prefix = Object.keys(OWNED_BY).find((key) => path === key || path.startsWith(`${key}/`));
  if (prefix) {
    const owner = OWNED_BY[prefix];
    const entry = entryForPath(groups, owner.route);
    const group = groupForPath(groups, owner.route);
    if (!entry || !group) return [];
    return [
      { label: workspace },
      { label: group.label },
      { label: entry.label, to: entry.route },
      { label: owner.label },
    ];
  }
  const entry = entryForPath(groups, path);
  const group = groupForPath(groups, path);
  if (!entry || !group) return [];
  const crumbs: Crumb[] = [{ label: workspace }, { label: group.label }];
  if (path === entry.route) {
    crumbs.push({ label: entry.label });
    return crumbs;
  }
  crumbs.push({ label: entry.label, to: entry.route });
  const rest = path.slice(entry.route.length + 1).split('/')[0];
  crumbs.push({ label: DETAIL_LABEL[rest] ?? 'Details' });
  return crumbs;
};

