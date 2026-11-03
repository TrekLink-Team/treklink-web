// The nearest-rank percentile of a list of durations: the smallest value at or above `percent` of the
// list, the ceil(p/100 * n)-th of the sorted values. Null for an empty list. Nearest-rank is a choice: it
// always answers a duration that happened, and it needs no interpolation between two incidents.
export const percentile = (values: readonly number[], percent: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[rank - 1];
};

export interface ResponseTimeRow {
  // Null for the row over every incident of the period, routed or not.
  organizationId: string | null;
  // Incidents first seen in the range (and routed to this organization, for an organization row).
  incidents: number;
  // Seconds from the first event to the first acknowledgement and to the resolution, as the median and
  // the 95th percentile of the incidents that reached that step; null when none did.
  ackMedianSec: number | null;
  ackP95Sec: number | null;
  resolveMedianSec: number | null;
  resolveP95Sec: number | null;
}

export interface IncidentTimes {
  organizationId: string | null;
  firstEventAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
}

const seconds = (from: Date, to: Date): number =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

interface Group {
  incidents: number;
  ack: number[];
  resolve: number[];
}

const add = (group: Group, incident: IncidentTimes): void => {
  group.incidents += 1;
  if (incident.acknowledgedAt)
    group.ack.push(seconds(incident.firstEventAt, incident.acknowledgedAt));
  if (incident.resolvedAt) group.resolve.push(seconds(incident.firstEventAt, incident.resolvedAt));
};

const rowOf = (organizationId: string | null, group: Group): ResponseTimeRow => ({
  organizationId,
  incidents: group.incidents,
  ackMedianSec: percentile(group.ack, 50),
  ackP95Sec: percentile(group.ack, 95),
  resolveMedianSec: percentile(group.resolve, 50),
  resolveP95Sec: percentile(group.resolve, 95),
});

// One row per routed organization, most incidents first and then by organization id so the order is
// stable, and last one row with a null organization computed over every incident of the period, unrouted
// ones included: a percentile of several organizations cannot be built from their own percentiles
// (monitoring api-design 08, incident-times). No row for a period with no incident.
export const responseTimesOf = (incidents: readonly IncidentTimes[]): ResponseTimeRow[] => {
  if (incidents.length === 0) return [];
  const everyone: Group = { incidents: 0, ack: [], resolve: [] };
  const byOrganization = new Map<string, Group>();
  for (const incident of incidents) {
    add(everyone, incident);
    if (incident.organizationId === null) continue;
    const group = byOrganization.get(incident.organizationId) ?? {
      incidents: 0,
      ack: [],
      resolve: [],
    };
    add(group, incident);
    byOrganization.set(incident.organizationId, group);
  }
  const rows = [...byOrganization.entries()]
    .map(([organizationId, group]) => rowOf(organizationId, group))
    .sort(
      (a, b) =>
        b.incidents - a.incidents || (a.organizationId ?? '').localeCompare(b.organizationId ?? ''),
    );
  return [...rows, rowOf(null, everyone)];
};
