import { Trail } from './trails';

// The movement styles of the field simulation (specs/demo/design.md §9.1, leader ruling 2026-11-06).
// Pure and stateless like the rest of the model: where a styled node is at a time follows from its
// anchor, the elapsed time and its seed, so every run computes the same packet. Every number of a style is
// drawn once from the seed inside the range of the design's table; the smooth random paths interpolate
// seeded values with a cosine, so a node never jumps. The geometry helpers are passed in by
// field-simulation.ts, which owns the trail maths.

export const SIMULATION_STYLES = [
  'JOGGER',
  'HIKER',
  'CAMPER',
  'EXPLORER',
  'TRAIL_WALKER',
  'WANDERER',
  'GROUP_FOLLOWER',
  'STRAGGLER',
] as const;
export type SimulationStyleName = (typeof SIMULATION_STYLES)[number];

// The fixed seed of the style assignment: the same asset tag gets the same style and path in every run.
export const STYLE_SEED_PREFIX = 'treklink-sim-v1';

/** FNV-1a, 32 bit, as an unsigned integer. */
export const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** The seed and the default style of a device, from its asset tag. The hash is shifted right one bit, so
 * the seed fits the signed 32-bit `styleSeed` column. */
export const styleFor = (assetTag: string): { style: SimulationStyleName; seed: number } => {
  const seed = fnv1a(`${STYLE_SEED_PREFIX}:${assetTag}`) >>> 1;
  return { style: SIMULATION_STYLES[seed % SIMULATION_STYLES.length], seed };
};

// A seeded value in [0, 1) for `seed` and a key; a stateless hash, so any value can be read at any time.
export const unit = (seed: number, key: string | number): number =>
  fnv1a(`${seed}:${key}`) / 0x1_0000_0000;

const between = (seed: number, key: string, low: number, high: number): number =>
  low + (high - low) * unit(seed, key);

// A smooth seeded value in [-1, 1] at `x` keyframes: cosine interpolation between hashed keyframes.
export const smooth = (seed: number, channel: string, x: number): number => {
  const k = Math.floor(x);
  const f = x - k;
  const a = unit(seed, `${channel}:${k}`) * 2 - 1;
  const b = unit(seed, `${channel}:${k + 1}`) * 2 - 1;
  const w = (1 - Math.cos(Math.PI * f)) / 2;
  return a + (b - a) * w;
};

// Battery drain a minute by style: the more active, the faster (design §9.1).
export const STYLE_DRAIN_PER_MINUTE: Record<SimulationStyleName, number> = {
  JOGGER: 0.25,
  HIKER: 0.15,
  CAMPER: 0.08,
  EXPLORER: 0.18,
  TRAIL_WALKER: 0.12,
  WANDERER: 0.08,
  GROUP_FOLLOWER: 0.12,
  STRAGGLER: 0.4,
};

/** Every style's numbers, drawn from the seed within the design's ranges. Speeds in m/s, times in s. */
export const styleParams = (seed: number) => ({
  jogger: { speed: between(seed, 'jog-speed', 2.5, 3.5) },
  hiker: {
    speed: between(seed, 'hike-speed', 1.2, 1.6),
    walk: between(seed, 'hike-walk', 15, 25) * 60,
    rest: between(seed, 'hike-rest', 5, 10) * 60,
    circle: between(seed, 'hike-circle', 3, 5) * 60,
    radius: between(seed, 'hike-radius', 20, 35),
  },
  camper: {
    speed: between(seed, 'camp-speed', 0.9, 1.1),
    along: between(seed, 'camp-along', 300, 800),
    aside: between(seed, 'camp-aside', 40, 80),
    stay: between(seed, 'camp-stay', 30, 60) * 60,
    home: between(seed, 'camp-home', 10, 20) * 60,
  },
  explorer: { reach: 150, keyframe: 420 },
  walker: {
    speed: between(seed, 'walk-speed', 0.9, 1.1),
    walk: between(seed, 'walk-walk', 12, 20) * 60,
    rest: between(seed, 'walk-rest', 3, 6) * 60,
  },
  wanderer: { reach: 40, keyframe: 240 },
  follower: {
    lag: between(seed, 'follow-lag', 20, 50),
    side: between(seed, 'follow-side', 5, 15) * (unit(seed, 'follow-sign') < 0.5 ? -1 : 1),
  },
  straggler: {
    stationary: unit(seed, 'straggle-kind') < 0.5,
    speed: between(seed, 'straggle-speed', 0.5, 0.7),
    walk: 10 * 60,
    rest: 5 * 60,
    drift: between(seed, 'straggle-drift', 60, 150),
    driftPeriod: 30 * 60,
    shadowEvery: between(seed, 'shadow-every', 30, 45) * 60,
    shadowFor: between(seed, 'shadow-for', 7, 10) * 60,
  },
});

// The lead guide of a trail's group (GROUP_FOLLOWER): a schedule of the trail and the clock, so every
// follower of one trail follows the same guide.
export const GUIDE_WALK_SECONDS = 20 * 60;
export const GUIDE_REST_SECONDS = 5 * 60;
export const guideSpeed = (trail: Trail): number =>
  between(fnv1a(`guide:${trail.id}`), 'speed', 1.0, 1.2);

/** Distance covered by `seconds` on a cycle of walking `walk` s then standing `rest` s, at `speed`. */
export const walkedOnCycle = (
  seconds: number,
  speed: number,
  walk: number,
  rest: number,
): number => {
  const cycle = walk + rest;
  const full = Math.floor(seconds / cycle);
  return (full * walk + Math.min(seconds - full * cycle, walk)) * speed;
};

/** Whether a STRAGGLER of `seed` is in a radio shadow `seconds` after its anchor (sends nothing). */
export const inShadow = (seed: number, seconds: number): boolean => {
  const { shadowEvery, shadowFor } = styleParams(seed).straggler;
  // The shadow sits at the end of each cycle, so a node is heard first after it starts.
  return seconds % shadowEvery >= shadowEvery - shadowFor;
};

// Geometry and the trail walk, handed in by field-simulation.ts.
export interface StyleGeometry {
  pointAt(metres: number): { lat: number; lon: number };
  bearingAt(metres: number): number;
  destination(
    from: { lat: number; lon: number },
    bearing: number,
    metres: number,
  ): { lat: number; lon: number };
  length: number;
}

export interface StyleAnchor {
  anchorMetres: number;
  anchorLat: number;
  anchorLon: number;
  direction: 1 | -1;
}

export interface StyledPosition {
  lat: number;
  lon: number;
  metres: number;
  direction: 1 | -1;
}

// Out and back along the trail: positions repeat every two lengths, the second half the other way.
const fold = (
  geometry: StyleGeometry,
  start: number,
  direction: 1 | -1,
  travelled: number,
): { metres: number; direction: 1 | -1 } => {
  const length = geometry.length;
  if (length === 0) return { metres: 0, direction };
  const period = 2 * length;
  const unfolded = start + direction * travelled;
  const x = ((unfolded % period) + period) % period;
  const outward = x <= length;
  return {
    metres: outward ? x : period - x,
    direction: outward ? direction : (-direction as 1 | -1),
  };
};

// Bearing in degrees clockwise from north from `a` to `b`, on a local flat approximation.
const bearingBetween = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number => {
  const north = b.lat - a.lat;
  const east = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
};

// Half the stretch of trail whose direction an offset to one side follows: an offset taken from a single
// segment would jump at every bend, by the offset times the turn.
const SIDE_SMOOTHING_METRES = 60;

const onTrail = (
  geometry: StyleGeometry,
  start: number,
  direction: 1 | -1,
  travelled: number,
  aside = 0,
): StyledPosition => {
  const at = fold(geometry, start, direction, travelled);
  const point = geometry.pointAt(at.metres);
  if (aside === 0) return { ...point, ...at };
  // To the right of the trail's own direction for a positive `aside`, whichever way the node walks, so
  // the turn at a trail end does not throw it across the trail.
  const behind = geometry.pointAt(Math.max(0, at.metres - SIDE_SMOOTHING_METRES));
  const ahead = geometry.pointAt(Math.min(geometry.length, at.metres + SIDE_SMOOTHING_METRES));
  const bearing = (bearingBetween(behind, ahead) + 90) % 360;
  return { ...geometry.destination(point, bearing, aside), ...at };
};

// A smooth random offset from the anchor that starts at zero, `reach` metres at most on each axis.
const roam = (
  geometry: StyleGeometry,
  node: StyleAnchor,
  seed: number,
  seconds: number,
  reach: number,
  keyframe: number,
): StyledPosition => {
  const x = seconds / keyframe;
  const east = (reach * (smooth(seed, 'east', x) - smooth(seed, 'east', 0))) / 2;
  const north = (reach * (smooth(seed, 'north', x) - smooth(seed, 'north', 0))) / 2;
  const origin = { lat: node.anchorLat, lon: node.anchorLon };
  const moved = geometry.destination(geometry.destination(origin, 90, east), 0, north);
  return { ...moved, metres: node.anchorMetres, direction: node.direction };
};

/** Where a node walking in `style` is `seconds` after its anchor (`at` is the clock, for the guide). */
export const styledPosition = (
  style: SimulationStyleName,
  seed: number,
  geometry: StyleGeometry,
  node: StyleAnchor,
  seconds: number,
  at: Date,
  trail: Trail,
): StyledPosition => {
  const p = styleParams(seed);
  switch (style) {
    case 'JOGGER':
      return onTrail(geometry, node.anchorMetres, node.direction, p.jogger.speed * seconds);
    case 'TRAIL_WALKER': {
      const { speed, walk, rest } = p.walker;
      return onTrail(
        geometry,
        node.anchorMetres,
        node.direction,
        walkedOnCycle(seconds, speed, walk, rest),
      );
    }
    case 'HIKER': {
      const { speed, walk, rest, circle, radius } = p.hiker;
      const cycle = walk + rest + circle;
      const travelled = walkedOnCycle(seconds, speed, walk, rest + circle);
      const phase = seconds % cycle;
      const base = onTrail(geometry, node.anchorMetres, node.direction, travelled);
      if (phase < walk + rest) return base;
      // One circle round the spot, starting and ending on it: the centre sits `radius` to the east.
      const angle = (2 * Math.PI * (phase - walk - rest)) / circle;
      const east = radius * (1 - Math.cos(angle));
      const north = radius * Math.sin(angle);
      const moved = geometry.destination(geometry.destination(base, 90, east), 0, north);
      return { ...base, ...moved };
    }
    case 'CAMPER': {
      const { speed, along, aside, stay, home } = p.camper;
      const origin = { lat: node.anchorLat, lon: node.anchorLon };
      const campMetres = Math.max(
        0,
        Math.min(geometry.length, node.anchorMetres + node.direction * along),
      );
      const campOnTrail = geometry.pointAt(campMetres);
      const camp = geometry.destination(
        campOnTrail,
        (geometry.bearingAt(campMetres) + 90) % 360,
        aside,
      );
      const north = (camp.lat - origin.lat) * 111_320;
      const east = (camp.lon - origin.lon) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
      const span = Math.hypot(north, east);
      const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
      const travel = span / speed;
      const cycle = 2 * travel + stay + home;
      const phase = seconds % cycle;
      let gone: number;
      if (phase < travel) gone = phase * speed;
      else if (phase < travel + stay) gone = span;
      else if (phase < 2 * travel + stay) gone = span - (phase - travel - stay) * speed;
      else gone = 0;
      let point = geometry.destination(origin, bearing, gone);
      // A slow drift within 10 m while camping, eased to zero at arrival and departure.
      if (phase >= travel && phase < travel + stay) {
        const x = (phase - travel) / 300;
        const ease = Math.sin((Math.PI * (phase - travel)) / stay);
        point = geometry.destination(
          geometry.destination(
            point,
            90,
            5 * ease * (smooth(seed, 'camp-e', x) - smooth(seed, 'camp-e', 0)),
          ),
          0,
          5 * ease * (smooth(seed, 'camp-n', x) - smooth(seed, 'camp-n', 0)),
        );
      }
      return { ...point, metres: node.anchorMetres, direction: node.direction };
    }
    case 'EXPLORER':
      return roam(geometry, node, seed, seconds, 2 * p.explorer.reach, p.explorer.keyframe);
    case 'WANDERER':
      return roam(geometry, node, seed, seconds, 2 * p.wanderer.reach, p.wanderer.keyframe);
    case 'GROUP_FOLLOWER': {
      const clock = at.getTime() / 1000;
      const guide = walkedOnCycle(clock, guideSpeed(trail), GUIDE_WALK_SECONDS, GUIDE_REST_SECONDS);
      const { lag, side } = p.follower;
      // A sway of up to 5 m round the follower's place, so the group never moves in lock step.
      const sway = 5 * smooth(seed, 'sway', clock / 120);
      return onTrail(geometry, 0, 1, Math.max(0, guide - lag), side + sway);
    }
    case 'STRAGGLER': {
      const s = p.straggler;
      if (s.stationary) {
        const x = seconds / 180;
        const origin = { lat: node.anchorLat, lon: node.anchorLon };
        const point = geometry.destination(
          geometry.destination(
            origin,
            90,
            1.5 * (smooth(seed, 'still-e', x) - smooth(seed, 'still-e', 0)),
          ),
          0,
          1.5 * (smooth(seed, 'still-n', x) - smooth(seed, 'still-n', 0)),
        );
        return { ...point, metres: node.anchorMetres, direction: node.direction };
      }
      const travelled = walkedOnCycle(seconds, s.speed, s.walk, s.rest);
      const aside = (s.drift * (1 - Math.cos((2 * Math.PI * seconds) / s.driftPeriod))) / 2;
      return onTrail(geometry, node.anchorMetres, node.direction, travelled, aside);
    }
  }
};
