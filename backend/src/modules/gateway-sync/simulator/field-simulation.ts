import { toNodeId } from '../../devices';
import {
  STYLE_DRAIN_PER_MINUTE,
  SimulationStyleName,
  inShadow,
  styledPosition,
} from './field-styles';
import { SimulatedPacket, simulatedPacket } from './simulated-batch';
import { Trail, TrailPoint } from './trails';

// The movement model of the field simulation (specs/demo/design.md §9, D-093 amendment). Pure and
// stateless: the state of a node at a time follows from its anchor and the elapsed time under its pattern,
// so every run and every instance computes the same packets for an interval, and ingestion stores each
// once (D-006 ids from node, kind and time).

export const SIMULATION_PATTERNS = ['WALK', 'STOP', 'STRAY', 'SILENT', 'LOW_BATTERY'] as const;
export type SimulationPatternName = (typeof SIMULATION_PATTERNS)[number];
export type SosKindName = 'SOS' | 'FALL';

// Simulation constants of design §9 ("Constants"); they shape synthetic data, not a business rule.
export const DEFAULT_SPEED_METRES_PER_MINUTE = 60;
export const MIN_SPEED_METRES_PER_MINUTE = 10;
export const MAX_SPEED_METRES_PER_MINUTE = 300;
export const STRAY_METRES = 300;
export const STRAY_SECONDS = 600;
export const BATTERY_START = 100;
export const BATTERY_FLOOR = 5;
export const BATTERY_DRAIN_PER_MINUTE = 0.1;
export const LOW_BATTERY_DRAIN_PER_MINUTE = 2;
// The firmware's SOS beacon cadence (firmware ground truth §2, quoted in design §9): every 5 s for the
// first 60 s, every 30 s after.
export const BEACON_FAST_SECONDS = 5;
export const BEACON_FAST_WINDOW_SECONDS = 60;
export const BEACON_SLOW_SECONDS = 30;
// After a long pause between runs, only the beacons of the last ten minutes are sent.
export const BEACON_LOOKBACK_SECONDS = 600;

const METRES_PER_DEGREE_LAT = 111_320;
const metresPerDegreeLon = (lat: number) => METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

const segmentMetres = (a: TrailPoint, b: TrailPoint) =>
  Math.hypot(
    (b[0] - a[0]) * METRES_PER_DEGREE_LAT,
    (b[1] - a[1]) * metresPerDegreeLon((a[0] + b[0]) / 2),
  );

interface Geometry {
  cumulative: number[]; // distance from the first point to point i
  length: number;
}

const geometries = new WeakMap<Trail, Geometry>();

const geometry = (trail: Trail): Geometry => {
  const known = geometries.get(trail);
  if (known) return known;
  const cumulative = [0];
  for (let i = 1; i < trail.points.length; i++) {
    cumulative.push(cumulative[i - 1] + segmentMetres(trail.points[i - 1], trail.points[i]));
  }
  const built = { cumulative, length: cumulative[cumulative.length - 1] };
  geometries.set(trail, built);
  return built;
};

export const trailLengthMetres = (trail: Trail): number => geometry(trail).length;

// The index of the segment that holds `metres`, clamped to the trail.
const segmentAt = (trail: Trail, metres: number): number => {
  const { cumulative } = geometry(trail);
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < metres) i++;
  return i - 1;
};

export interface LatLon {
  lat: number;
  lon: number;
}

export const pointAt = (trail: Trail, metres: number): LatLon => {
  const { cumulative, length } = geometry(trail);
  const m = Math.max(0, Math.min(length, metres));
  const i = segmentAt(trail, m);
  const a = trail.points[i];
  const b = trail.points[Math.min(i + 1, trail.points.length - 1)];
  const span = cumulative[i + 1] - cumulative[i];
  const f = span > 0 ? (m - cumulative[i]) / span : 0;
  return { lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f };
};

// Bearing in degrees clockwise from north of the segment that holds `metres`.
export const bearingAt = (trail: Trail, metres: number): number => {
  const i = segmentAt(trail, metres);
  const a = trail.points[i];
  const b = trail.points[Math.min(i + 1, trail.points.length - 1)];
  const north = (b[0] - a[0]) * METRES_PER_DEGREE_LAT;
  const east = (b[1] - a[1]) * metresPerDegreeLon(a[0]);
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
};

// A point `metres` from `from` along `bearing`, on a local flat approximation (a few hundred metres).
export const destination = (from: LatLon, bearing: number, metres: number): LatLon => {
  const rad = (bearing * Math.PI) / 180;
  return {
    lat: from.lat + (metres * Math.cos(rad)) / METRES_PER_DEGREE_LAT,
    lon: from.lon + (metres * Math.sin(rad)) / metresPerDegreeLon(from.lat),
  };
};

export const distanceMetres = (a: LatLon, b: LatLon): number =>
  Math.hypot(
    (b.lat - a.lat) * METRES_PER_DEGREE_LAT,
    (b.lon - a.lon) * metresPerDegreeLon((a.lat + b.lat) / 2),
  );

// The anchor of a simulated node, as the `simulated_nodes` row stores it.
export interface SimulationAnchor {
  pattern: SimulationPatternName;
  speedMetresPerMinute: number;
  anchorAt: Date;
  anchorMetres: number;
  anchorLat: number;
  anchorLon: number;
  anchorBattery: number;
  direction: number; // 1 or -1
  strayBearing: number | null;
  // How the node moves while its pattern walks (design §9.1); null keeps the steady walk at the speed.
  style: SimulationStyleName | null;
  styleSeed: number;
}

export interface SimulatedState extends LatLon {
  metres: number; // distance along the trail the node follows
  direction: 1 | -1; // the way it moves along the trail now
  battery: number;
}

const sign = (direction: number): 1 | -1 => (direction < 0 ? -1 : 1);

const walks = (pattern: SimulationPatternName) => pattern === 'WALK' || pattern === 'LOW_BATTERY';

// The node's state at `at`; a time before the anchor counts as the anchor time.
export const stateAt = (trail: Trail, node: SimulationAnchor, at: Date): SimulatedState => {
  const seconds = Math.max(0, (at.getTime() - node.anchorAt.getTime()) / 1000);
  const minutes = seconds / 60;
  const rate =
    node.pattern === 'LOW_BATTERY'
      ? LOW_BATTERY_DRAIN_PER_MINUTE
      : node.style
        ? STYLE_DRAIN_PER_MINUTE[node.style]
        : BATTERY_DRAIN_PER_MINUTE;
  const battery = Math.max(
    BATTERY_FLOOR,
    Math.min(node.anchorBattery, node.anchorBattery - rate * minutes),
  );
  const direction = sign(node.direction);
  if (walks(node.pattern) && node.style) {
    const position = styledPosition(
      node.style,
      node.styleSeed,
      {
        pointAt: (metres) => pointAt(trail, metres),
        bearingAt: (metres) => bearingAt(trail, metres),
        destination,
        length: trailLengthMetres(trail),
      },
      {
        anchorMetres: node.anchorMetres,
        anchorLat: node.anchorLat,
        anchorLon: node.anchorLon,
        direction,
      },
      seconds,
      new Date(node.anchorAt.getTime() + seconds * 1000),
      trail,
    );
    return { ...position, battery };
  }
  if (walks(node.pattern)) {
    const length = trailLengthMetres(trail);
    if (length === 0) return { ...pointAt(trail, 0), metres: 0, direction, battery };
    // Unfold the out-and-back walk: positions repeat every two lengths, and the node moves the other
    // way on the second half, so the turn at either end is continuous.
    const unfolded = node.anchorMetres + direction * node.speedMetresPerMinute * minutes;
    const period = 2 * length;
    const x = ((unfolded % period) + period) % period;
    const outward = x <= length;
    const metres = outward ? x : period - x;
    return {
      ...pointAt(trail, metres),
      metres,
      direction: outward ? direction : (-direction as 1 | -1),
      battery,
    };
  }
  const anchor = { lat: node.anchorLat, lon: node.anchorLon };
  if (node.pattern === 'STRAY' && node.strayBearing !== null) {
    const travelled = STRAY_METRES * Math.min(1, seconds / STRAY_SECONDS);
    return {
      ...destination(anchor, node.strayBearing, travelled),
      metres: node.anchorMetres,
      direction,
      battery,
    };
  }
  return { ...anchor, metres: node.anchorMetres, direction, battery };
};

// The stray bearing for a node leaving the trail at `metres`: perpendicular to it, to the right of the
// direction of travel.
export const strayBearingAt = (trail: Trail, metres: number, direction: number): number =>
  (bearingAt(trail, metres) + (direction < 0 ? 180 : 0) + 90) % 360;

// The anchor of a node that starts on `trail` at `startMetres`.
export const startAnchor = (
  trail: Trail,
  input: {
    pattern: SimulationPatternName;
    speedMetresPerMinute: number;
    startMetres: number;
    style?: SimulationStyleName | null;
    styleSeed?: number;
  },
  at: Date,
): SimulationAnchor => {
  const metres = Math.max(0, Math.min(trailLengthMetres(trail), input.startMetres));
  const point = pointAt(trail, metres);
  return {
    pattern: input.pattern,
    speedMetresPerMinute: input.speedMetresPerMinute,
    anchorAt: at,
    anchorMetres: metres,
    anchorLat: point.lat,
    anchorLon: point.lon,
    anchorBattery: BATTERY_START,
    direction: 1,
    strayBearing: input.pattern === 'STRAY' ? strayBearingAt(trail, metres, 1) : null,
    style: input.style ?? null,
    styleSeed: input.styleSeed ?? 0,
  };
};

// A new anchor at the node's state now, so the move continues from where it is (design §9). A new trail
// starts at its first point. A node that walked keeps its distance along the trail; one that stood or
// strayed keeps the trail point it left from, and walks back onto the trail from there.
export const reanchor = (
  trail: Trail,
  node: SimulationAnchor,
  at: Date,
  change: {
    pattern?: SimulationPatternName;
    speedMetresPerMinute?: number;
    trail?: Trail;
    style?: SimulationStyleName;
  },
): SimulationAnchor => {
  const state = stateAt(trail, node, at);
  const pattern = change.pattern ?? node.pattern;
  const speedMetresPerMinute = change.speedMetresPerMinute ?? node.speedMetresPerMinute;
  const style = change.style ?? node.style;
  if (change.trail && change.trail !== trail) {
    return {
      ...startAnchor(
        change.trail,
        { pattern, speedMetresPerMinute, startMetres: 0, style, styleSeed: node.styleSeed },
        at,
      ),
      anchorBattery: state.battery,
    };
  }
  const metres = walks(node.pattern) ? state.metres : node.anchorMetres;
  return {
    pattern,
    speedMetresPerMinute,
    anchorAt: at,
    anchorMetres: metres,
    anchorLat: state.lat,
    anchorLon: state.lon,
    anchorBattery: state.battery,
    direction: state.direction,
    strayBearing: pattern === 'STRAY' ? strayBearingAt(trail, metres, state.direction) : null,
    style,
    styleSeed: node.styleSeed,
  };
};

// The beacon times of an SOS that started at `sosSeconds`, in (fromSeconds, toSeconds]: every 5 s for the
// first 60 s (offsets 0 to 60), then every 30 s.
export const beaconSeconds = (
  sosSeconds: number,
  fromSeconds: number,
  toSeconds: number,
): number[] => {
  const times: number[] = [];
  for (let offset = 0; offset <= BEACON_FAST_WINDOW_SECONDS; offset += BEACON_FAST_SECONDS) {
    const t = sosSeconds + offset;
    if (t > fromSeconds && t <= toSeconds) times.push(t);
  }
  const firstSlow = BEACON_FAST_WINDOW_SECONDS + BEACON_SLOW_SECONDS;
  const startK = Math.max(
    0,
    Math.ceil((fromSeconds - sosSeconds - firstSlow) / BEACON_SLOW_SECONDS),
  );
  for (let k = startK; ; k++) {
    const t = sosSeconds + firstSlow + k * BEACON_SLOW_SECONDS;
    if (t > toSeconds) break;
    if (t > fromSeconds) times.push(t);
  }
  return times;
};

// The mesh node id the packets carry: `!` and eight lower-case hex digits of nodeNum (devices `toNodeId`).
export const nodeIdOf = (nodeNum: bigint | number): string => toNodeId(BigInt(nodeNum));

export const positionPacket = (
  sender: string,
  seconds: number,
  at: LatLon,
  key: 'position' | 'beacon',
): SimulatedPacket =>
  simulatedPacket(
    sender,
    seconds,
    'position',
    {
      time: seconds,
      latitude_i: Math.round(at.lat * 1e7),
      longitude_i: Math.round(at.lon * 1e7),
    },
    key,
  );

export const telemetryPacket = (
  sender: string,
  seconds: number,
  battery: number,
): SimulatedPacket =>
  simulatedPacket(
    sender,
    seconds,
    'telemetry',
    {
      battery_level: Math.round(battery),
      channel_utilization: 3.5,
      air_util_tx: 0.8,
    },
    'telemetry',
  );

// The SOS text the firmware sends (TrekLinkSOSHelper.h, firmware ground truth §2), six decimals.
export const sosText = (kind: SosKindName, at: LatLon): string =>
  `${kind === 'FALL' ? 'SOS - FALL DETECTED - ' : 'SOS - '}[${at.lat.toFixed(6)}], [${at.lon.toFixed(6)}]`;

export const sosPacket = (
  sender: string,
  seconds: number,
  kind: SosKindName,
  at: LatLon,
): SimulatedPacket =>
  simulatedPacket(
    sender,
    seconds,
    'text',
    { text: sosText(kind, at) },
    kind === 'FALL' ? 'fall' : 'sos',
  );

// What a running node sends in the run at `now`.
export interface SimulatedNodeState extends SimulationAnchor {
  nodeNum: bigint;
  sosKind: SosKindName | null;
  sosSince: Date | null;
  beaconedUntil: Date | null;
}

export interface RunPlan {
  packets: SimulatedPacket[];
  // The time of the last beacon planned, to store as `beaconedUntil`; unchanged when none.
  beaconedUntil: Date | null;
}

// One position (unless an SOS is active, whose beacons replace it) and one telemetry packet timed at the
// start of the interval that holds `now`, none for SILENT; plus the beacons of an active SOS due since
// `beaconedUntil`, at most the last BEACON_LOOKBACK_SECONDS of them.
export const planRun = (
  trail: Trail,
  node: SimulatedNodeState,
  now: Date,
  intervalSeconds: number,
): RunPlan => {
  const sender = nodeIdOf(node.nodeNum);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const seconds = nowSeconds - (nowSeconds % intervalSeconds);
  const packets: SimulatedPacket[] = [];
  const sosActive = node.sosKind !== null && node.sosSince !== null;
  // A walking STRAGGLER in its radio shadow sends nothing, like SILENT (design §9.1).
  const shadowed =
    walks(node.pattern) &&
    node.style === 'STRAGGLER' &&
    inShadow(node.styleSeed, Math.max(0, seconds - node.anchorAt.getTime() / 1000));
  if (node.pattern !== 'SILENT' && !shadowed) {
    const state = stateAt(trail, node, new Date(seconds * 1000));
    if (!sosActive) packets.push(positionPacket(sender, seconds, state, 'position'));
    packets.push(telemetryPacket(sender, seconds, state.battery));
  }
  let beaconedUntil = node.beaconedUntil;
  if (sosActive) {
    const sosSeconds = Math.floor(node.sosSince!.getTime() / 1000);
    const done = node.beaconedUntil
      ? Math.floor(node.beaconedUntil.getTime() / 1000)
      : sosSeconds - 1;
    const from = Math.max(done, nowSeconds - BEACON_LOOKBACK_SECONDS);
    for (const t of beaconSeconds(sosSeconds, from, nowSeconds)) {
      packets.push(positionPacket(sender, t, stateAt(trail, node, new Date(t * 1000)), 'beacon'));
      beaconedUntil = new Date(t * 1000);
    }
  }
  return { packets, beaconedUntil };
};
