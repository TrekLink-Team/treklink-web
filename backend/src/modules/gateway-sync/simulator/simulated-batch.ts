import { TA_NANG_PHAN_DUNG_POINTS } from './trails';

// The field data simulator of design §2 (field data simulator) (D-090 rule 2): one batch of synthetic stock Meshtastic packets
// for the demo seed's simulated nodes, the same shape the gateway's FrameSimulator publishes
// (gateway/src/serial/simulator.ts, mqtt-ingress-contract.md). Pure and stateless: the batch depends only
// on the time, so every instance builds the same packets for an interval and ingestion stores them once
// (deduplication on `from` and `id`, D-006).

// TL-0009 and TL-0010 of backend/prisma/seed-demo.ts, the gateway simulator's default nodes.
export const SIMULATED_NODES = ['!de000009', '!de00000a'] as const;

// The trail both nodes walk: `ta-nang-phan-dung` of trails.ts, OpenStreetMap way 1164619760.
const TRAIL = TA_NANG_PHAN_DUNG_POINTS;

const METRES_PER_DEGREE_LAT = 111_320;
const metresPerDegreeLon = (lat: number) => METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
const segmentMetres = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.hypot(
    (b[0] - a[0]) * METRES_PER_DEGREE_LAT,
    (b[1] - a[1]) * metresPerDegreeLon((a[0] + b[0]) / 2),
  );

// A fixed pseudo-random value in [0, 1) per integer, so the walk is the same on every instance.
const unit = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Walking speed per segment, 0.8 to 1.4 m/s; two rests of four minutes where the walker stands still.
const SEGMENTS = TRAIL.slice(1).map((point, i) => ({
  metres: segmentMetres(TRAIL[i], point),
  speed: 0.8 + 0.6 * unit(i),
}));
const REST_SECONDS = 240;
const REST_AFTER = new Set([Math.floor(SEGMENTS.length * 0.35), Math.floor(SEGMENTS.length * 0.7)]);

// One leg (start to end) as timed steps; the return leg walks the same steps backwards, so the turn at
// either end is continuous.
interface Step {
  from: number; // index of the point the step starts at
  to: number;
  seconds: number; // a rest is a step with from === to
}
const LEG: Step[] = SEGMENTS.flatMap((segment, i) => [
  { from: i, to: i + 1, seconds: segment.metres / segment.speed },
  ...(REST_AFTER.has(i) ? [{ from: i + 1, to: i + 1, seconds: REST_SECONDS }] : []),
]);
const LEG_SECONDS = LEG.reduce((sum, step) => sum + step.seconds, 0);
const RETURN: Step[] = [...LEG]
  .reverse()
  .map((step) => ({ ...step, from: step.to, to: step.from }));
const CYCLE: Step[] = [...LEG, ...RETURN];
export const CYCLE_SECONDS = 2 * LEG_SECONDS;

// TL-0010 walks the same trail a quarter of an hour ahead of TL-0009, as a group further along.
const OFFSET_SECONDS = [0, 900];
// A smooth deterministic wobble of up to 3 m, so the track is not a perfect line.
const JITTER_METRES = 3;

export const positionAt = (index: number, seconds: number): { lat: number; lon: number } => {
  let t =
    (((seconds + (OFFSET_SECONDS[index] ?? 0)) % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  let step = CYCLE[CYCLE.length - 1];
  for (const candidate of CYCLE) {
    if (t < candidate.seconds) {
      step = candidate;
      break;
    }
    t -= candidate.seconds;
  }
  const fraction = step.seconds > 0 ? Math.min(1, t / step.seconds) : 0;
  const [lat0, lon0] = TRAIL[step.from];
  const [lat1, lon1] = TRAIL[step.to];
  const lat = lat0 + (lat1 - lat0) * fraction;
  const lon = lon0 + (lon1 - lon0) * fraction;
  const wobbleNorth = JITTER_METRES * Math.sin(seconds / 47 + index * 2.1);
  const wobbleEast = JITTER_METRES * Math.cos(seconds / 61 + index * 1.3);
  return {
    lat: lat + wobbleNorth / METRES_PER_DEGREE_LAT,
    lon: lon + wobbleEast / metresPerDegreeLon(lat),
  };
};

// Distance in metres from a point to the nearest trail segment, for tests.
export const metresFromTrail = (point: { lat: number; lon: number }): number =>
  Math.min(
    ...TRAIL.slice(1).map((b, i) => {
      const a = TRAIL[i];
      const kx = metresPerDegreeLon(a[0]);
      const [ax, ay] = [a[1] * kx, a[0] * METRES_PER_DEGREE_LAT];
      const [bx, by] = [b[1] * kx, b[0] * METRES_PER_DEGREE_LAT];
      const [px, py] = [point.lon * kx, point.lat * METRES_PER_DEGREE_LAT];
      const [dx, dy] = [bx - ax, by - ay];
      const len = dx * dx + dy * dy;
      const r = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
      return Math.hypot(px - (ax + r * dx), py - (ay + r * dy));
    }),
  );

export interface SimulatedPacket {
  id: number;
  timestamp: number;
  to: number;
  from: number;
  channel: number;
  type: 'position' | 'telemetry' | 'text';
  sender: string;
  payload: Record<string, unknown>;
  rssi: number;
  snr: number;
  hops_away: number;
  hop_start: number;
}

// FNV-1a over the text, folded to a positive 31-bit id that is never 0.
export const packetId = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & 0x7fffffff || 1;
};

const nodeNum = (sender: string) => Number.parseInt(sender.slice(1), 16);

// One percent per ten minutes over a ten-hour cycle: never under 40%.
const battery = (seconds: number) => 100 - Math.floor((seconds % 36_000) / 600);

export const simulatedPacket = (
  sender: string,
  seconds: number,
  type: SimulatedPacket['type'],
  payload: Record<string, unknown>,
  key: string,
): SimulatedPacket => ({
  id: packetId(`${sender}:${key}:${seconds}`),
  timestamp: seconds,
  to: 0xffffffff,
  from: nodeNum(sender),
  channel: 0,
  type,
  sender,
  payload,
  rssi: -95,
  snr: 6.25,
  hops_away: 0,
  hop_start: 3,
});

/**
 * The packets of the interval that contains `now`: a position and a telemetry reading per node, timed at
 * the interval's start. With `sosIntervalMinutes` above 0, the first batch of each SOS window adds the
 * first node's SOS text in the firmware's "SOS - [lat], [lon]" form; 0 never sends one.
 */
export const simulatedBatch = (
  now: Date,
  intervalSeconds: number,
  sosIntervalMinutes: number,
): SimulatedPacket[] => {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const seconds = nowSeconds - (nowSeconds % intervalSeconds);
  const packets: SimulatedPacket[] = [];
  SIMULATED_NODES.forEach((sender, index) => {
    const at = positionAt(index, seconds);
    packets.push(
      simulatedPacket(
        sender,
        seconds,
        'position',
        {
          time: seconds,
          latitude_i: Math.round(at.lat * 1e7),
          longitude_i: Math.round(at.lon * 1e7),
          altitude: 1300,
        },
        'position',
      ),
      simulatedPacket(
        sender,
        seconds,
        'telemetry',
        {
          battery_level: battery(seconds),
          voltage: 4.1,
          channel_utilization: 3.5,
          air_util_tx: 0.8,
          uptime_seconds: seconds % 36_000,
        },
        'telemetry',
      ),
    );
  });
  if (sosIntervalMinutes > 0) {
    const window = sosIntervalMinutes * 60;
    const windowStart = nowSeconds - (nowSeconds % window);
    if (seconds - windowStart < intervalSeconds && seconds >= windowStart) {
      const sender = SIMULATED_NODES[0];
      const at = positionAt(0, seconds);
      packets.push(
        simulatedPacket(
          sender,
          seconds,
          'text',
          { text: `SOS - [${at.lat.toFixed(6)}], [${at.lon.toFixed(6)}]` },
          'sos',
        ),
      );
    }
  }
  return packets;
};
