// The field data simulator of design §2 (field data simulator) (D-090 rule 2): one batch of synthetic stock Meshtastic packets
// for the demo seed's simulated nodes, the same shape the gateway's FrameSimulator publishes
// (gateway/src/serial/simulator.ts, mqtt-ingress-contract.md). Pure and stateless: the batch depends only
// on the time, so every instance builds the same packets for an interval and ingestion stores them once
// (deduplication on `from` and `id`, D-006).

// TL-0009 and TL-0010 of backend/prisma/seed-demo.ts, the gateway simulator's default nodes.
export const SIMULATED_NODES = ['!de000009', '!de00000a'] as const;

// Where the loops are centred: the gateway simulator's start point (Ta Nang, the fixtures' area).
const CENTRE = { lat: 11.5544, lon: 108.5381 };
// One loop of about 330 m radius in 30 minutes, about 1.2 m/s: walking pace, well under
// monitoring.maxPlausibleSpeedKmh. The second node walks a smaller loop half a turn behind.
const LOOP_SECONDS = 1800;
const LOOPS = [
  { radius: 0.003, phase: 0 },
  { radius: 0.002, phase: Math.PI },
];

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
const packetId = (text: string): number => {
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

const packet = (
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

export const positionAt = (index: number, seconds: number): { lat: number; lon: number } => {
  const { radius, phase } = LOOPS[index % LOOPS.length];
  const angle = (2 * Math.PI * (seconds % LOOP_SECONDS)) / LOOP_SECONDS + phase;
  return { lat: CENTRE.lat + radius * Math.sin(angle), lon: CENTRE.lon + radius * Math.cos(angle) };
};

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
      packet(
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
      packet(
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
        packet(
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
