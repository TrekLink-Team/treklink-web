// Groups live markers that would overlap at the current zoom (leader ruling 2026-11-06, superseding the
// ring spread of W14c). Markers are never moved off their readings: zoomed out, a group draws as one
// cluster badge at the true centroid of its devices; zoomed in, a group stays stacked at its exact
// positions, the most severe marker on top, and activating it lists every device there.

import type { MarkerState } from '../status';

/** Smallest pointer target of a marker, in CSS px (WCAG 2.2, 2.5.8). Markers closer than this stack. */
export const STACK_REACH_PX = 24;
/** Markers whose target centres sit closer than this, in CSS px, form one cluster when zoomed out. */
export const CLUSTER_REACH_PX = 48;
/** From this zoom level up, markers no longer cluster; overlapping ones stack instead. */
export const CLUSTER_UNTIL_ZOOM = 14;
/** The drawn size of a cluster badge, in CSS px: the 44 px touch target of the UI standard. */
export const CLUSTER_BADGE_PX = 44;

/** Most severe first: SOS, the other incident states, not heard, offline, docked, live. */
export const SEVERITY_ORDER: readonly MarkerState[] = [
  'sos',
  'attention',
  'unheard',
  'stale',
  // A unit docked at the counter outside any custody (devices design section 12.8): no alert, so it ranks
  // just above live.
  'docked',
  'fresh',
];

export const severityRank = (state: MarkerState): number => SEVERITY_ORDER.indexOf(state);

export interface ClusterPoint {
  id: string;
  /** Centre of the marker's target in world pixels at the current zoom. */
  x: number;
  y: number;
  state: MarkerState;
}

export interface PointGroup {
  /** Member ids, most severe first, then by id. */
  ids: string[];
  /** The true centroid of the members, in the same pixels as the input. */
  x: number;
  y: number;
  /** The most severe state inside. */
  state: MarkerState;
}

interface Working {
  members: ClusterPoint[];
  x: number;
  y: number;
}

const bySeverity = (a: ClusterPoint, b: ClusterPoint): number =>
  severityRank(a.state) - severityRank(b.state) || a.id.localeCompare(b.id);

/**
 * Groups points whose centres sit closer than `reach` pixels. Every point starts as its own group, and
 * the two groups whose centroids are closest, under `reach`, merge until no pair is left; a merged
 * group sits at the centroid of all its members. Points are taken in id order and ties go to the
 * earlier pair, so the grouping is the same at every redraw. The work is quadratic per merge, which
 * stays well under a frame for the fleets of a few hundred units this map shows.
 */
export const groupPoints = (input: ClusterPoint[], reach: number): PointGroup[] => {
  const groups: Working[] = [...input]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ members: [p], x: p.x, y: p.y }));

  for (;;) {
    let best: [number, number] | null = null;
    let bestDistance = reach;
    for (let a = 0; a < groups.length; a += 1)
      for (let b = a + 1; b < groups.length; b += 1) {
        const gap = Math.hypot(groups[a].x - groups[b].x, groups[a].y - groups[b].y);
        if (gap < bestDistance) [best, bestDistance] = [[a, b], gap];
      }
    if (!best) break;
    const [a, b] = best;
    const members = [...groups[a].members, ...groups[b].members];
    groups[a] = {
      members,
      x: members.reduce((sum, p) => sum + p.x, 0) / members.length,
      y: members.reduce((sum, p) => sum + p.y, 0) / members.length,
    };
    groups.splice(b, 1);
  }

  return groups.map(({ members, x, y }) => {
    const ordered = [...members].sort(bySeverity);
    return { ids: ordered.map((p) => p.id), x, y, state: ordered[0].state };
  });
};

const COUNT_WORD: Record<MarkerState, [string, string]> = {
  sos: ['SOS', 'SOS'],
  attention: ['needs attention', 'need attention'],
  unheard: ['not heard since handover', 'not heard since handover'],
  stale: ['offline', 'offline'],
  docked: ['docked at the counter', 'docked at the counter'],
  fresh: ['live', 'live'],
};

/**
 * The accessible name of a cluster: the device count, then each state that is not live with its count,
 * most severe first, then where it is. "12 devices, 1 SOS, 2 offline, near 11.5601, 108.5402".
 */
export const clusterName = (states: MarkerState[], near: string): string => {
  const counts = new Map<MarkerState, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  const parts = SEVERITY_ORDER.filter((state) => state !== 'fresh' && counts.has(state)).map(
    (state) => {
      const count = counts.get(state)!;
      return `${count} ${COUNT_WORD[state][count === 1 ? 0 : 1]}`;
    },
  );
  return [`${states.length} devices`, ...parts, `near ${near}`].join(', ');
};

/** Coordinates as a place, to four decimals (about 11 m), latitude first. */
export const nearText = (lat: number, lon: number): string =>
  `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
