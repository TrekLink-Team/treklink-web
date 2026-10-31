import { PriorityTier } from '../../src/config';

// The figures of one outage trial (gateway-sync task 5.3) against the NFR table of
// specs/gateway-sync/requirements.md §3: NFR-REL-01 latency with the uplink up, NFR-REL-02 delivery of
// the events generated during the outage, NFR-REL-04 P0 before any P2 or P3 on the flush.

/** NFR-REL-01: Field Station to cloud within 5 s with the uplink up. */
export const LATENCY_BUDGET_MS = 5_000;
/** NFR-REL-02: at least 99 % of the events generated during the outage are delivered. */
export const DELIVERY_TARGET = 0.99;
/** NFR-REL-04: at least 99 % of the P0 events reach the cloud before any P2 or P3 on the flush. */
export const ORDERING_TARGET = 0.99;

export interface EventRecord {
  key: string;
  tier: PriorityTier;
  /** Harness clock, epoch ms, when the packet came off the simulated serial port and was queued. */
  generatedAt: number;
  /** When the backend stand-in first received it. */
  receivedAt?: number;
  /** Position among first arrivals, 0 for the first message the backend stand-in received. */
  arrival?: number;
}

export interface TrialTimes {
  cutAt: number;
  restoreAt: number;
  /** When the last event that was queued at the restore arrived, or undefined when one never did. */
  backlogDrainedAt?: number;
}

export interface Percentiles {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface TrialSummary {
  outageMs: number;
  generated: number;
  delivered: number;
  duplicates: number;
  /** NFR-REL-02 */
  outageGenerated: number;
  outageDelivered: number;
  deliveryRate: number | null;
  /** NFR-REL-01, events generated with the uplink up and settled, see `steadyState`. */
  steadyLatency: Percentiles;
  /** Informational: how late the events generated during the outage arrived. */
  outageLatency: Percentiles;
  /** NFR-REL-04, over the backlog queued at the restore. */
  backlogP0: number;
  backlogP0BeforeLow: number;
  orderingRate: number | null;
  /** Backlog P2 and P3 events that arrived before at least one backlog P0: the ordering faults. */
  lowAheadOfP0: number;
  /**
   * Of those, the ones generated before the cut: publishes in flight when the uplink dropped, which
   * mqtt.js replays on reconnect ahead of anything the flush sends (mqtt 5.15.2 lib/client.js).
   */
  lowAheadOfP0InFlight: number;
  /** Restore to the last backlog arrival, ms. */
  drainMs: number | null;
}

export const percentiles = (values: number[]): Percentiles => {
  if (values.length === 0) return { count: 0, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank percentile.
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { count: sorted.length, p50: rank(50), p95: rank(95), max: sorted[sorted.length - 1] };
};

// An event counts for NFR-REL-01 when its whole budget ran with the uplink up and no backlog ahead of
// it: generated at least LATENCY_BUDGET_MS before the cut, or after the backlog drained. An event
// generated in the last 5 s before the cut that had not arrived by then is caught by the outage and is
// measured with the backlog instead.
export const steadyState = (event: EventRecord, times: TrialTimes): boolean =>
  event.generatedAt <= times.cutAt - LATENCY_BUDGET_MS ||
  (times.backlogDrainedAt !== undefined && event.generatedAt >= times.backlogDrainedAt);

/** The events queued at the restore and not yet received then: what the flush after the outage sends. */
export const backlogAt = (events: EventRecord[], restoreAt: number): EventRecord[] =>
  events.filter((event) => event.generatedAt < restoreAt && (event.receivedAt === undefined || event.receivedAt >= restoreAt));

export const summarize = (events: EventRecord[], times: TrialTimes, duplicates: number): TrialSummary => {
  const latency = (event: EventRecord) => (event.receivedAt as number) - event.generatedAt;
  const delivered = events.filter((event) => event.receivedAt !== undefined);
  const during = events.filter((event) => event.generatedAt >= times.cutAt && event.generatedAt < times.restoreAt);
  const duringDelivered = during.filter((event) => event.receivedAt !== undefined);
  const steady = delivered.filter((event) => steadyState(event, times));
  // A steady-state event that never arrived is a latency failure, so it counts as infinitely late.
  const steadyLost = events.filter((event) => event.receivedAt === undefined && steadyState(event, times)).length;

  const backlog = backlogAt(events, times.restoreAt);
  const low = backlog.filter((event) => event.tier === PriorityTier.P2_GPS || event.tier === PriorityTier.P3_TELEMETRY);
  const firstLow = Math.min(...low.map((event) => event.arrival ?? Number.POSITIVE_INFINITY));
  const p0 = backlog.filter((event) => event.tier === PriorityTier.P0_SOS);
  const p0First = p0.filter((event) => event.arrival !== undefined && event.arrival < firstLow).length;
  const lastP0 = Math.max(...p0.map((event) => event.arrival ?? Number.POSITIVE_INFINITY));
  const ahead = low.filter((event) => event.arrival !== undefined && event.arrival < lastP0);

  return {
    outageMs: times.restoreAt - times.cutAt,
    generated: events.length,
    delivered: delivered.length,
    duplicates,
    outageGenerated: during.length,
    outageDelivered: duringDelivered.length,
    deliveryRate: during.length === 0 ? null : duringDelivered.length / during.length,
    steadyLatency: percentiles([...steady.map(latency), ...Array<number>(steadyLost).fill(Number.POSITIVE_INFINITY)]),
    outageLatency: percentiles(duringDelivered.map(latency)),
    backlogP0: p0.length,
    backlogP0BeforeLow: p0First,
    orderingRate: p0.length === 0 ? null : p0First / p0.length,
    lowAheadOfP0: ahead.length,
    lowAheadOfP0InFlight: ahead.filter((event) => event.generatedAt < times.cutAt).length,
    drainMs: times.backlogDrainedAt === undefined ? null : times.backlogDrainedAt - times.restoreAt,
  };
};

export interface ConditionVerdict {
  outageMs: number;
  trials: number;
  /** Pooled over every trial of the condition. */
  deliveryRate: number | null;
  minTrialDeliveryRate: number | null;
  orderingRate: number | null;
  latencyP95: number | null;
  latencyMax: number | null;
  nfrRel01: boolean;
  nfrRel02: boolean;
  nfrRel04: boolean;
  /** NFR-REL-02 asks for at least 20 trials per condition; fewer is indicative only. */
  enoughTrials: boolean;
}

export const judge = (trials: TrialSummary[], minTrials = 20): ConditionVerdict => {
  const sum = (pick: (trial: TrialSummary) => number) => trials.reduce((total, trial) => total + pick(trial), 0);
  const generated = sum((trial) => trial.outageGenerated);
  const p0 = sum((trial) => trial.backlogP0);
  const rates = trials.map((trial) => trial.deliveryRate).filter((rate): rate is number => rate !== null);
  const latencyMax = Math.max(...trials.map((trial) => trial.steadyLatency.max ?? Number.NEGATIVE_INFINITY));
  const latencyP95 = Math.max(...trials.map((trial) => trial.steadyLatency.p95 ?? Number.NEGATIVE_INFINITY));
  const deliveryRate = generated === 0 ? null : sum((trial) => trial.outageDelivered) / generated;
  const orderingRate = p0 === 0 ? null : sum((trial) => trial.backlogP0BeforeLow) / p0;
  return {
    outageMs: trials[0]?.outageMs ?? 0,
    trials: trials.length,
    deliveryRate,
    minTrialDeliveryRate: rates.length === 0 ? null : Math.min(...rates),
    orderingRate,
    // No steady-state event in any trial leaves the latency unmeasured rather than passing.
    latencyP95: latencyP95 === Number.NEGATIVE_INFINITY ? null : latencyP95,
    latencyMax: latencyMax === Number.NEGATIVE_INFINITY ? null : latencyMax,
    nfrRel01: latencyMax !== Number.NEGATIVE_INFINITY && latencyMax <= LATENCY_BUDGET_MS,
    nfrRel02: deliveryRate !== null && deliveryRate >= DELIVERY_TARGET,
    nfrRel04: orderingRate !== null && orderingRate >= ORDERING_TARGET,
    enoughTrials: trials.length >= minTrials,
  };
};
