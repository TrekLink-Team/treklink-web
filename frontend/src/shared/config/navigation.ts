import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  Cpu,
  FileText,
  Gauge,
  KeyRound,
  LayoutGrid,
  ListChecks,
  Map as MapIcon,
  MapPin,
  Radio,
  Receipt,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Siren,
  Store,
  Tags,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react';
import { hasAnyRole, type Role } from '../lib/permissions';

// The sidebar, drawer and phone tab bar are all drawn from this one table (DS-13).
// Routes and roles follow specs/frontend/design.md §2. Set `built: true` in the same pull request
// that registers the route in app/router.tsx; unbuilt entries stay hidden.

export interface NavEntry {
  /** Unique key; also the route for leaf entries. */
  route: string;
  label: string;
  icon: LucideIcon;
  /** Roles that see the entry. Inheritance applies: ADMIN gets STAFF, ORG_MANAGER gets ORG_OPERATOR. */
  roles: readonly Role[];
  built: boolean;
  /** The map routes: full-bleed content, no Info pane (convention 06 §4 Pattern B). */
  fullBleed?: boolean;
  /** Shown in the phone tab bar, in this order, at most four (the fifth slot is More). */
  tabBar?: number;
}

export interface NavGroup {
  id: string;
  label: string;
  entries: NavEntry[];
}

const OPERATOR: Role[] = ['ORG_OPERATOR'];
const MANAGER: Role[] = ['ORG_MANAGER'];
const STAFF: Role[] = ['STAFF'];
const ADMIN: Role[] = ['ADMIN'];

export const ORGANIZATION_NAV: NavGroup[] = [
  {
    id: 'o-operate',
    label: 'Operate',
    entries: [
      { route: '/o', label: 'Overview', icon: LayoutGrid, roles: MANAGER, built: true, tabBar: 1 },
      { route: '/o/map', label: 'Live map', icon: MapIcon, roles: OPERATOR, built: true, fullBleed: true, tabBar: 2 },
      { route: '/o/incidents', label: 'Incidents', icon: Siren, roles: OPERATOR, built: true, tabBar: 3 },
    ],
  },
  {
    id: 'o-business',
    label: 'Business',
    entries: [
      { route: '/o/contracts', label: 'Contracts', icon: FileText, roles: OPERATOR, built: true, tabBar: 4 },
      { route: '/o/invoices', label: 'Invoices', icon: Receipt, roles: MANAGER, built: true },
      { route: '/o/loss-cases', label: 'Loss cases', icon: ShieldAlert, roles: MANAGER, built: false },
    ],
  },
  {
    id: 'o-organization',
    label: 'Organization',
    entries: [
      { route: '/o/members', label: 'Members', icon: Users, roles: MANAGER, built: true },
      { route: '/o/roster', label: 'Roster', icon: CalendarDays, roles: OPERATOR, built: true },
      { route: '/o/api-keys', label: 'API keys', icon: KeyRound, roles: MANAGER, built: true },
      { route: '/o/field-stations', label: 'Field stations', icon: MapPin, roles: OPERATOR, built: true },
    ],
  },
];

export const TREKLINK_NAV: NavGroup[] = [
  {
    id: 't-operate',
    label: 'Operate',
    entries: [
      { route: '/t/map', label: 'Fleet map', icon: MapIcon, roles: STAFF, built: true, fullBleed: true, tabBar: 1 },
      { route: '/t/incidents', label: 'Incidents', icon: Siren, roles: STAFF, built: true, tabBar: 2 },
    ],
  },
  {
    id: 't-contracts',
    label: 'Contracts and counter',
    entries: [{ route: '/t/contracts', label: 'Contracts', icon: FileText, roles: STAFF, built: true, tabBar: 3 }],
  },
  {
    id: 't-fleet',
    label: 'Fleet',
    entries: [
      { route: '/t/fleet', label: 'Devices', icon: Cpu, roles: STAFF, built: true },
      { route: '/t/admin/sync', label: 'Field data sync', icon: Radio, roles: STAFF, built: true },
      { route: '/t/stock-take', label: 'Stock-take', icon: ClipboardList, roles: STAFF, built: false },
      { route: '/t/maintenance', label: 'Maintenance', icon: Wrench, roles: STAFF, built: true },
      { route: '/t/loss-cases', label: 'Loss cases', icon: ShieldAlert, roles: STAFF, built: false },
    ],
  },
  {
    id: 't-organizations',
    label: 'Organizations and compliance',
    entries: [
      { route: '/t/organizations', label: 'Organizations', icon: Building2, roles: STAFF, built: true },
      { route: '/t/compliance-cases', label: 'Compliance cases', icon: ShieldCheck, roles: STAFF, built: true },
    ],
  },
  {
    id: 't-billing',
    label: 'Billing',
    entries: [
      { route: '/t/billing', label: 'Invoices and payments', icon: Receipt, roles: STAFF, built: true, tabBar: 4 },
      { route: '/t/damage-charges', label: 'Damage charges', icon: BadgeDollarSign, roles: STAFF, built: true },
    ],
  },
  {
    id: 't-reports',
    label: 'Reports',
    entries: [{ route: '/t/reports', label: 'Reports', icon: BarChart3, roles: STAFF, built: false }],
  },
  {
    id: 't-admin',
    label: 'Administration',
    entries: [
      { route: '/t/admin/accounts', label: 'Accounts', icon: UserCog, roles: ADMIN, built: false },
      { route: '/t/admin/roles', label: 'Roles and permissions', icon: ListChecks, roles: ADMIN, built: false },
      { route: '/t/admin/parameters', label: 'Parameters', icon: SlidersHorizontal, roles: ADMIN, built: false },
      { route: '/t/admin/prices', label: 'Prices and damage rates', icon: Tags, roles: ADMIN, built: true },
      { route: '/t/admin/variants', label: 'Hardware variants', icon: Store, roles: ADMIN, built: false },
      { route: '/t/admin/health', label: 'System health', icon: Gauge, roles: ADMIN, built: false },
      { route: '/t/admin/audit/changes', label: 'Audit log', icon: ScrollText, roles: ADMIN, built: false },
      { route: '/t/admin/audit/sign-ins', label: 'Sign-in events', icon: Activity, roles: ADMIN, built: false },
    ],
  },
];

/** Includes unbuilt entries: the design system page lists them to show the whole map of the app. */
export const ALL_NAV: NavGroup[] = [...ORGANIZATION_NAV, ...TREKLINK_NAV];

/** Built entries the roles may open, grouped, with empty groups removed. */
export const visibleNav = (
  accountType: 'TREKLINK' | 'ORGANIZATION',
  roles: readonly string[],
  options: { includeUnbuilt?: boolean } = {},
): NavGroup[] =>
  (accountType === 'TREKLINK' ? TREKLINK_NAV : ORGANIZATION_NAV)
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) => (entry.built || options.includeUnbuilt) && hasAnyRole(roles, entry.roles),
      ),
    }))
    .filter((group) => group.entries.length > 0);

/** The entry that owns a path: the longest route that prefixes it. */
export const entryForPath = (groups: NavGroup[], path: string): NavEntry | undefined =>
  groups
    .flatMap((group) => group.entries)
    .filter((entry) => path === entry.route || path.startsWith(`${entry.route}/`))
    .sort((a, b) => b.route.length - a.route.length)[0];

/** The group that owns a path, for the breadcrumb. */
export const groupForPath = (groups: NavGroup[], path: string): NavGroup | undefined => {
  const entry = entryForPath(groups, path);
  return entry ? groups.find((group) => group.entries.includes(entry)) : undefined;
};

/** Full-bleed routes, also for paths outside the nav table. */
export const isFullBleed = (path: string): boolean =>
  ALL_NAV.some((group) => group.entries.some((entry) => entry.fullBleed && (path === entry.route || path.startsWith(`${entry.route}/`))));

/** Tab bar entries for the phone, ordered; More opens the drawer. */
export const tabBarEntries = (groups: NavGroup[]): NavEntry[] =>
  groups
    .flatMap((group) => group.entries)
    .filter((entry) => entry.tabBar !== undefined)
    .sort((a, b) => (a.tabBar ?? 0) - (b.tabBar ?? 0))
    .slice(0, 4);
