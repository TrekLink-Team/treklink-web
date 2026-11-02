import { decodeStock } from '../adapters/stock-json';
import { Normalizer } from '../normalizer/normalizer';
import {
  BATTERY_FLOOR,
  SimulatedNodeState,
  SimulationAnchor,
  beaconSeconds,
  distanceMetres,
  nodeIdOf,
  planRun,
  reanchor,
  sosText,
  startAnchor,
  stateAt,
  trailLengthMetres,
} from './field-simulation';
import { TRAILS, trailById } from './trails';

const trail = trailById('ta-nang-phan-dung')!;
const t0 = new Date('2026-11-06T02:00:00Z');
const after = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

const anchor = (pattern: SimulationAnchor['pattern'], startMetres = 1000): SimulationAnchor =>
  startAnchor(trail, { pattern, speedMetresPerMinute: 60, startMetres }, t0);

const node = (
  pattern: SimulationAnchor['pattern'],
  extra: Partial<SimulatedNodeState> = {},
): SimulatedNodeState => ({
  ...anchor(pattern),
  nodeNum: 0xde00000an,
  sosKind: null,
  sosSince: null,
  beaconedUntil: null,
  ...extra,
});

// Distance from a point to the nearest trail segment, on the same flat approximation.
const metresFromTrail = (p: { lat: number; lon: number }) =>
  Math.min(
    ...trail.points.slice(1).map((b, i) => {
      const a = trail.points[i];
      const k = 111_320 * Math.cos((a[0] * Math.PI) / 180);
      const [ax, ay, bx, by] = [a[1] * k, a[0] * 111_320, b[1] * k, b[0] * 111_320];
      const [px, py] = [p.lon * k, p.lat * 111_320];
      const [dx, dy] = [bx - ax, by - ay];
      const len = dx * dx + dy * dy;
      const r = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
      return Math.hypot(px - (ax + r * dx), py - (ay + r * dy));
    }),
  );

describe('trails (design §9)', () => {
  it('lists the Ta Nang to Phan Dung path of D-090 with its OpenStreetMap provenance', () => {
    expect(trail.source.osmWayIds).toEqual([1164619760]);
    expect(trail.points).toHaveLength(63);
    expect(trailLengthMetres(trail)).toBeGreaterThan(7000);
    expect(trailLengthMetres(trail)).toBeLessThan(7500);
  });

  it('gives every trail a unique id, Vietnamese coordinates and a read date', () => {
    expect(new Set(TRAILS.map((t) => t.id)).size).toBe(TRAILS.length);
    for (const t of TRAILS) {
      expect(t.source.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.source.osmWayIds.length).toBeGreaterThan(0);
      for (const [lat, lon] of t.points) {
        expect(lat).toBeGreaterThan(8);
        expect(lat).toBeLessThan(24);
        expect(lon).toBeGreaterThan(102);
        expect(lon).toBeLessThan(110);
      }
    }
  });
});

describe('stateAt per pattern (REQ-SIM-04)', () => {
  it('WALK moves along the trail at the node speed and stays on it', () => {
    const walk = anchor('WALK');
    const s = stateAt(trail, walk, after(600));
    expect(s.metres).toBeCloseTo(1600, 3);
    expect(metresFromTrail(s)).toBeLessThan(0.5);
    // 60 m a minute: one minute later the node is within 60 m, never further.
    expect(distanceMetres(s, stateAt(trail, walk, after(660)))).toBeLessThanOrEqual(60.01);
  });

  it('WALK turns back at the end of the trail without a jump', () => {
    const length = trailLengthMetres(trail);
    const near = startAnchor(
      trail,
      { pattern: 'WALK', speedMetresPerMinute: 60, startMetres: length - 30 },
      t0,
    );
    const turned = stateAt(trail, near, after(60));
    expect(turned.metres).toBeCloseTo(length - 30, 3);
    expect(turned.direction).toBe(-1);
    expect(
      distanceMetres(stateAt(trail, near, after(29)), stateAt(trail, near, after(31))),
    ).toBeLessThan(3);
  });

  it('STOP stays where it is and drains the battery slowly', () => {
    const stop = anchor('STOP');
    const s = stateAt(trail, stop, after(3600));
    expect(s.lat).toBe(stop.anchorLat);
    expect(s.lon).toBe(stop.anchorLon);
    expect(s.battery).toBeCloseTo(94, 6);
  });

  it('STRAY leaves the trail 300 m to one side over ten minutes, then stays', () => {
    const stray = anchor('STRAY');
    expect(stray.strayBearing).not.toBeNull();
    expect(metresFromTrail(stateAt(trail, stray, after(300)))).toBeGreaterThan(100);
    const end = stateAt(trail, stray, after(600));
    expect(distanceMetres({ lat: stray.anchorLat, lon: stray.anchorLon }, end)).toBeCloseTo(300, 1);
    expect(stateAt(trail, stray, after(1200))).toMatchObject({ lat: end.lat, lon: end.lon });
  });

  it('LOW_BATTERY walks while the battery falls 2 points a minute, never below 5', () => {
    const low = anchor('LOW_BATTERY');
    expect(stateAt(trail, low, after(600)).battery).toBeCloseTo(80, 6);
    expect(stateAt(trail, low, after(600)).metres).toBeCloseTo(1600, 3);
    expect(stateAt(trail, low, after(3600)).battery).toBe(BATTERY_FLOOR);
  });

  it('SILENT stays where it is', () => {
    const silent = anchor('SILENT');
    expect(stateAt(trail, silent, after(600)).lat).toBe(silent.anchorLat);
  });

  it('counts a time before the anchor as the anchor time', () => {
    expect(stateAt(trail, anchor('WALK'), after(-60)).metres).toBeCloseTo(1000, 6);
  });
});

describe('reanchor (design §9, a change continues from where the node is)', () => {
  it('keeps the position of a walking node that stops', () => {
    const walk = anchor('WALK');
    const now = after(300);
    const stopped = reanchor(trail, walk, now, { pattern: 'STOP' });
    expect(stopped.anchorAt).toEqual(now);
    expect(stopped.anchorMetres).toBeCloseTo(1300, 3);
    const { lat, lon, metres } = stateAt(trail, walk, now);
    expect(stateAt(trail, stopped, after(900))).toMatchObject({ lat, lon, metres });
  });

  it('strays from the current point and walks back onto the trail from the point it left', () => {
    const strayed = reanchor(trail, anchor('WALK'), after(300), { pattern: 'STRAY' });
    const off = stateAt(trail, strayed, after(900));
    expect(metresFromTrail(off)).toBeGreaterThan(200);
    const back = reanchor(trail, strayed, after(900), { pattern: 'WALK' });
    expect(back.anchorMetres).toBeCloseTo(1300, 3);
    expect(metresFromTrail(stateAt(trail, back, after(960)))).toBeLessThan(0.5);
  });

  it('carries the battery over and starts a new trail at its first point', () => {
    const low = anchor('LOW_BATTERY');
    const moved = reanchor(trail, low, after(600), { trail, pattern: 'WALK' });
    expect(moved.anchorBattery).toBeCloseTo(80, 6);
    const other = { ...trail, id: 'copy' };
    const elsewhere = reanchor(trail, low, after(600), { trail: other });
    expect(elsewhere.anchorMetres).toBe(0);
    expect(elsewhere.anchorBattery).toBeCloseTo(80, 6);
  });
});

describe('beaconSeconds (firmware ground truth §2: 5 s for 60 s, then 30 s)', () => {
  it('lists the beacons of the first two minutes', () => {
    expect(beaconSeconds(1000, 999, 1120)).toEqual([
      1000, 1005, 1010, 1015, 1020, 1025, 1030, 1035, 1040, 1045, 1050, 1055, 1060, 1090, 1120,
    ]);
  });

  it('returns only the beacons after `from`, including `to`', () => {
    expect(beaconSeconds(1000, 1060, 1180)).toEqual([1090, 1120, 1150, 1180]);
    expect(beaconSeconds(1000, 1180, 1200)).toEqual([]);
  });
});

describe('planRun', () => {
  const sosAt = after(30);

  it('sends a position and a telemetry packet timed at the interval start, repeatable in the interval', () => {
    const walk = node('WALK');
    const first = planRun(trail, walk, after(75), 60);
    expect(first.packets.map((p) => p.type)).toEqual(['position', 'telemetry']);
    expect(first.packets[0].timestamp).toBe(Math.floor(after(60).getTime() / 1000));
    expect(first.packets[0].sender).toBe('!de00000a');
    expect(planRun(trail, walk, after(119), 60).packets).toEqual(first.packets);
    expect(planRun(trail, walk, after(120), 60).packets[0].id).not.toBe(first.packets[0].id);
  });

  it('sends nothing for a SILENT node', () => {
    expect(planRun(trail, node('SILENT'), after(75), 60).packets).toEqual([]);
  });

  it('replaces the position with the SOS beacons due since beaconedUntil, and keeps the telemetry', () => {
    const sos = node('WALK', { sosKind: 'SOS', sosSince: sosAt, beaconedUntil: sosAt });
    const plan = planRun(trail, sos, after(120), 60);
    const beacons = plan.packets.filter((p) => p.type === 'position');
    // Offsets 5 to 60 (twelve), then 90: the beacon at offset 0 went with the SOS text.
    expect(beacons).toHaveLength(13);
    expect(plan.packets.filter((p) => p.type === 'telemetry')).toHaveLength(1);
    expect(plan.beaconedUntil).toEqual(after(120));
    const again = planRun(trail, { ...sos, beaconedUntil: plan.beaconedUntil }, after(140), 60);
    expect(again.packets.filter((p) => p.type === 'position')).toHaveLength(0);
  });

  it('sends only the last ten minutes of beacons after a long pause', () => {
    const sos = node('STOP', { sosKind: 'FALL', sosSince: sosAt, beaconedUntil: sosAt });
    const plan = planRun(trail, sos, after(30 + 3600), 60);
    expect(plan.packets.filter((p) => p.type === 'position')).toHaveLength(20);
  });

  it('sends beacons from a SILENT node in SOS, with no telemetry', () => {
    const sos = node('SILENT', { sosKind: 'SOS', sosSince: sosAt, beaconedUntil: sosAt });
    expect(planRun(trail, sos, after(40), 60).packets.map((p) => p.type)).toEqual([
      'position',
      'position',
    ]);
  });

  it('builds packets the ingestion pipeline decodes and normalizes', () => {
    const sos = node('WALK', { sosKind: 'SOS', sosSince: sosAt, beaconedUntil: sosAt });
    const normalizer = new Normalizer();
    for (const packet of planRun(trail, sos, after(120), 60).packets) {
      const decoded = decodeStock(Buffer.from(JSON.stringify(packet)));
      expect(decoded.kind).toBe('packet');
      if (decoded.kind === 'packet')
        expect(() =>
          normalizer.normalize(decoded.packet.type, decoded.packet.payload),
        ).not.toThrow();
    }
  });
});

describe('sosText and nodeIdOf', () => {
  it('writes the firmware strings with six decimals', () => {
    expect(sosText('SOS', { lat: 11.4975912, lon: 108.5686461 })).toBe(
      'SOS - [11.497591], [108.568646]',
    );
    expect(sosText('FALL', { lat: 11.4975912, lon: 108.5686461 })).toBe(
      'SOS - FALL DETECTED - [11.497591], [108.568646]',
    );
  });

  it('formats the node id as the firmware does', () => {
    expect(nodeIdOf(0xde00000an)).toBe('!de00000a');
    expect(nodeIdOf(10)).toBe('!0000000a');
  });
});
