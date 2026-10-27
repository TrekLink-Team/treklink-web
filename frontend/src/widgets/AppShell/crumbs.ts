import { entryForPath, groupForPath, type NavGroup } from '../../shared/config/navigation';
import type { Crumb } from '../../shared/ui/PageHeader';

const DETAIL_LABEL: Record<string, string> = { new: 'New' };

// The breadcrumb every page gets from the shell: workspace, area, module and, below a module, the
// record. Pages outside the nav table pass their own trail to PageHeader instead.
export const crumbsFor = (groups: NavGroup[], path: string, workspace: string): Crumb[] => {
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

