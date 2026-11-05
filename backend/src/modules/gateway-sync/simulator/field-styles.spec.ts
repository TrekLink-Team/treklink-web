import {
  LatLon,
  SimulatedNodeState,
  SimulationAnchor,
  distanceMetres,
  planRun,
  pointAt,
  reanchor,
  startAnchor,
  stateAt,
  trailLengthMetres,
} from './field-simulation';
import {
  SIMULATION_STYLES,
  STYLE_DRAIN_PER_MINUTE,
  SimulationStyleName,
  fnv1a,
  inShadow,
  styleFor,
  styleParams,
} from './field-styles';
import { trailById } from './trails';

// Movement envelopes of the styles of specs/demo/design.md §9.1, each with a fixed seed: the fastest step
// between two readings 10 s apart, how far the node goes from the trail or its anchor, and the rests,
// camp stays, group spread and radio shadows the table promises.

const trail = trailById('ta-nang-phan-dung')!;
const t0 = new Date('2026-11-06T02:00:00Z');
const SEED = fnv1a('treklink-sim-v1:TL-0042');
const STEP = 10;
const HOURS = 4;

const anchorFor = (
  style: SimulationStyleName,
  seed = SEED,
  startMetres = 2000,
  pattern: SimulationAnchor['pattern'] = 'WALK',
): SimulationAnchor =>
  startAnchor(
    trail,
    { pattern, speedMetresPerMinute: 60, startMetres, style, styleSeed: seed },
    t0,
  );

const track = (anchor: SimulationAnchor, hours = HOURS) => {
  const points: (LatLon & { battery: number })[] = [];
  for (let s = 0; s <= hours * 3600; s += STEP)
    points.push(stateAt(trail, anchor, new Date(t0.getTime() + s * 1000)));
  return points;
};

const steps = (points: LatLon[]) =>
  points.slice(1).map((p, i) => distanceMetres(points[i], p) / STEP);

// The trail sampled every 10 m, for the distance of a point from it.
const trailSamples: LatLon[] = [];
for (let m = 0; m <= trailLengthMetres(trail); m += 10) trailSamples.push(pointAt(trail, m));
const offTrail = (p: LatLon) => Math.min(...trailSamples.map((q) => distanceMetres(p, q)));

// The longest run of readings that did not move, in seconds.
const longestRest = (points: LatLon[]) => {
  let longest = 0;
  let run = 0;
  for (const speed of steps(points)) {
    run = speed < 0.01 ? run + STEP : 0;
    longest = Math.max(longest, run);
  }
  return longest;
};

const seedWhere = (test: (seed: number) => boolean): number => {
  for (let i = 0; i < 500; i += 1) {
    const seed = fnv1a(`treklink-sim-v1:TL-${String(i).padStart(4, '0')}`);
    if (test(seed)) return seed;
  }
  throw new Error('no seed found');
};

describe('styleFor (design §9.1)', () => {
  it('gives the same style and seed to the same asset tag in every run', () => {
    expect(styleFor('TL-0009')).toEqual(styleFor('TL-0009'));
    expect(styleFor('TL-0009').seed).toBe(fnv1a('treklink-sim-v1:TL-0009') >>> 1);
  });

  it('keeps every seed inside the signed 32-bit column', () => {
    for (let i = 0; i < 2000; i += 1) {
      const { seed } = styleFor(`TL-${String(i).padStart(4, '0')}`);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });

  it('spreads the fleet over the styles', () => {
    const styles = new Set(
      Array.from({ length: 40 }, (_, i) => styleFor(`TL-${String(i + 1).padStart(4, '0')}`).style),
    );
    expect(styles.size).toBeGreaterThanOrEqual(6);
    for (const style of styles) expect(SIMULATION_STYLES).toContain(style);
  });
});

describe('movement envelopes with a fixed seed', () => {
  it('repeats the same path for the same seed', () => {
    for (const style of SIMULATION_STYLES)
      expect(track(anchorFor(style), 0.5)).toEqual(track(anchorFor(style), 0.5));
  });

  it('JOGGER runs at a steady 2.5 to 3.5 m/s on the trail', () => {
    const anchor = anchorFor('JOGGER');
    const points = track(anchor, 1);
    const pace = styleParams(SEED).jogger.speed;
    expect(pace).toBeGreaterThanOrEqual(2.5);
    expect(pace).toBeLessThanOrEqual(3.5);
    expect(Math.max(...steps(points))).toBeLessThanOrEqual(3.6);
    // Steady: along the trail it covers its pace every second, away from a trail end.
    const along = (s: number) => stateAt(trail, anchor, new Date(t0.getTime() + s * 1000)).metres;
    for (const s of [0, 600, 1200, 1800])
      expect(Math.abs(along(s + 60) - along(s))).toBeCloseTo(pace * 60, 3);
    expect(Math.max(...points.map(offTrail))).toBeLessThan(10);
  });

  it('HIKER walks at 1.2 to 1.6 m/s, stops for a break, then circles the spot', () => {
    const points = track(anchorFor('HIKER'));
    const speeds = steps(points);
    const { speed, rest, radius } = styleParams(SEED).hiker;
    expect(speed).toBeGreaterThanOrEqual(1.2);
    expect(speed).toBeLessThanOrEqual(1.6);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(1.7);
    expect(longestRest(points)).toBeGreaterThanOrEqual(rest - STEP);
    // The circle leaves the trail by its diameter at most.
    const off = Math.max(...points.map(offTrail));
    expect(off).toBeGreaterThan(radius / 2);
    expect(off).toBeLessThanOrEqual(2 * radius + 10);
  });

  it('CAMPER goes to its camp off the trail, stays there for a while, then comes back', () => {
    const anchor = anchorFor('CAMPER');
    const points = track(anchor, 6);
    const { stay, aside } = styleParams(SEED).camper;
    expect(Math.max(...steps(points))).toBeLessThanOrEqual(1.3);
    // A stay: a window of `stay` seconds whose readings sit within 12 m of each other.
    const window = Math.floor((stay - 60) / STEP);
    const camped = points.some((p, i) =>
      points.slice(i, i + window).every((q) => distanceMetres(p, q) <= 12),
    );
    expect(camped).toBe(true);
    const origin = { lat: anchor.anchorLat, lon: anchor.anchorLon };
    const far = Math.max(...points.map((p) => distanceMetres(origin, p)));
    expect(far).toBeGreaterThan(250);
    // Back home within the six hours.
    expect(points.slice(1).some((p) => distanceMetres(origin, p) < 1)).toBe(true);
    expect(Math.max(...points.map(offTrail))).toBeLessThanOrEqual(aside + 25);
  });

  it('EXPLORER roams at walking speed within 300 m of its anchor on each axis', () => {
    const anchor = anchorFor('EXPLORER');
    const points = track(anchor);
    expect(Math.max(...steps(points))).toBeLessThanOrEqual(1.7);
    const origin = { lat: anchor.anchorLat, lon: anchor.anchorLon };
    const far = Math.max(...points.map((p) => distanceMetres(origin, p)));
    expect(far).toBeGreaterThan(80);
    expect(far).toBeLessThanOrEqual(300 * Math.SQRT2 + 1);
  });

  it('TRAIL_WALKER keeps to the trail at about 1 m/s with rest stops', () => {
    const points = track(anchorFor('TRAIL_WALKER'));
    const speeds = steps(points);
    const { speed, rest } = styleParams(SEED).walker;
    expect(speed).toBeGreaterThanOrEqual(0.9);
    expect(speed).toBeLessThanOrEqual(1.1);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(1.15);
    expect(longestRest(points)).toBeGreaterThanOrEqual(rest - STEP);
    expect(Math.max(...points.map(offTrail))).toBeLessThan(10);
  });

  it('WANDERER drifts slowly within 80 m of its camp on each axis', () => {
    const anchor = anchorFor('WANDERER');
    const points = track(anchor);
    const speeds = steps(points);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(1.0);
    expect(speeds.reduce((a, b) => a + b, 0) / speeds.length).toBeLessThan(0.5);
    const origin = { lat: anchor.anchorLat, lon: anchor.anchorLon };
    expect(Math.max(...points.map((p) => distanceMetres(origin, p)))).toBeLessThanOrEqual(
      80 * Math.SQRT2 + 1,
    );
  });

  it('GROUP_FOLLOWER keeps a few tens of metres behind the guide, with the group together', () => {
    const a = track(anchorFor('GROUP_FOLLOWER', SEED, 0));
    // Another follower, started elsewhere on the trail with its own seed, walks with the same group.
    const other = fnv1a('treklink-sim-v1:TL-0007');
    const b = track(anchorFor('GROUP_FOLLOWER', other, 5000));
    expect(Math.max(...steps(a))).toBeLessThanOrEqual(1.4);
    const spread = a.map((p, i) => distanceMetres(p, b[i]));
    expect(Math.max(...spread)).toBeLessThanOrEqual(80);
    expect(Math.max(...a.map(offTrail))).toBeLessThanOrEqual(25);
  });

  it('STRAGGLER either stands at camp or lags and drifts off the trail and back', () => {
    const still = seedWhere((seed) => styleParams(seed).straggler.stationary);
    const anchor = anchorFor('STRAGGLER', still);
    const origin = { lat: anchor.anchorLat, lon: anchor.anchorLon };
    expect(Math.max(...track(anchor).map((p) => distanceMetres(origin, p)))).toBeLessThanOrEqual(5);

    const lagging = seedWhere((seed) => !styleParams(seed).straggler.stationary);
    const points = track(anchorFor('STRAGGLER', lagging));
    const { drift } = styleParams(lagging).straggler;
    // A lag of 0.5 to 0.7 m/s; a bend under the widest drift adds a little, still a walking pace.
    expect(Math.max(...steps(points))).toBeLessThanOrEqual(1.2);
    const off = Math.max(...points.map(offTrail));
    expect(off).toBeGreaterThan(drift / 2);
    expect(off).toBeLessThanOrEqual(drift + 10);
  });
});

describe('battery and radio shadow by style', () => {
  it('drains the battery by the style, and LOW_BATTERY still drains 2 points a minute', () => {
    const at = new Date(t0.getTime() + 60 * 60 * 1000);
    for (const style of SIMULATION_STYLES)
      expect(stateAt(trail, anchorFor(style), at).battery).toBeCloseTo(
        100 - 60 * STYLE_DRAIN_PER_MINUTE[style],
        6,
      );
    expect(stateAt(trail, anchorFor('JOGGER', SEED, 2000, 'LOW_BATTERY'), at).battery).toBe(5);
  });

  it('sends nothing from a walking STRAGGLER in its radio shadow, and packets outside it', () => {
    const anchor = anchorFor('STRAGGLER');
    const state: SimulatedNodeState = {
      ...anchor,
      nodeNum: 0x1234abcdn,
      sosKind: null,
      sosSince: null,
      beaconedUntil: null,
    };
    const { shadowEvery } = styleParams(SEED).straggler;
    const counts = [];
    for (let s = 0; s < shadowEvery; s += 60) {
      const plan = planRun(trail, state, new Date(t0.getTime() + s * 1000), 10);
      counts.push({ shadow: inShadow(SEED, s), packets: plan.packets.length });
    }
    expect(counts.some((c) => c.shadow && c.packets === 0)).toBe(true);
    expect(counts.filter((c) => !c.shadow).every((c) => c.packets === 2)).toBe(true);
    // STOP is no walk: no shadow.
    const stopped = { ...state, pattern: 'STOP' as const };
    const inside = counts.findIndex((c) => c.shadow) * 60;
    expect(
      planRun(trail, stopped, new Date(t0.getTime() + inside * 1000), 10).packets,
    ).toHaveLength(2);
  });
});

describe('a style change continues from where the node is', () => {
  it('keeps the position when a jogger becomes a wanderer', () => {
    const anchor = anchorFor('JOGGER');
    const at = new Date(t0.getTime() + 600 * 1000);
    const before = stateAt(trail, anchor, at);
    const next = reanchor(trail, anchor, at, { style: 'WANDERER' });
    expect(next.style).toBe('WANDERER');
    expect(next.styleSeed).toBe(SEED);
    const after = stateAt(trail, next, at);
    expect(distanceMetres(before, after)).toBeLessThan(0.01);
  });

  it('keeps the steady walk for a node with no style', () => {
    const plain = startAnchor(
      trail,
      { pattern: 'WALK', speedMetresPerMinute: 60, startMetres: 0 },
      t0,
    );
    expect(plain.style).toBeNull();
    const state = stateAt(trail, plain, new Date(t0.getTime() + 60_000));
    expect(state.metres).toBeCloseTo(60, 6);
  });
});
