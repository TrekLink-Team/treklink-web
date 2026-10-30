import { randomInt } from 'node:crypto';
import { gatewayConfig, PriorityTier } from '../config';

// One packet in the stock Meshtastic JSON shape the firmware's MQTT uplink publishes
// (treklink-firmware MeshPacketSerializer.cpp; the backend fixtures in backend/test/fixtures/mqtt).
export interface StockPacket {
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

// The queue tier of a packet: an SOS text first, then positions, then telemetry. Text that is not an
// SOS travels with the positions.
export const tierOf = (packet: StockPacket): PriorityTier => {
  if (packet.type === 'text' && /^SOS\b/.test(String(packet.payload.text ?? ''))) {
    return PriorityTier.P0_SOS;
  }
  return packet.type === 'telemetry' ? PriorityTier.P3_TELEMETRY : PriorityTier.P2_GPS;
};

// "!de000009" to its node number.
const nodeNum = (sender: string) => Number.parseInt(sender.replace(/^!/, ''), 16);

// Simulation mode (GATEWAY_SERIAL_SIMULATION, no node on the USB port): each tick produces, for every
// configured node, a position that walks a few metres from the start point and a telemetry reading
// with a slowly draining battery; every GATEWAY_SIM_SOS_EVERY ticks the first node sends an SOS with
// its position, in the firmware's "SOS - [lat], [lon]" form (TrekLinkSOSHelper.h).
// One percent per five minutes of simulated uptime, never under 15%: units stay plausible through an
// hour-long demo (it drained one percent per tick, so a 5 s tick read 5% after under ten minutes).
export const simulatedBattery = (uptimeSeconds: number): number =>
  Math.max(15, 100 - Math.floor(uptimeSeconds / 300));

export class FrameSimulator {
  private tick = 0;
  private readonly positions = new Map<string, { lat: number; lon: number }>();

  constructor(private readonly config = gatewayConfig.simulation) {
    for (const sender of config.nodes) {
      this.positions.set(sender, { lat: config.startLat, lon: config.startLon });
    }
  }

  next(now: Date = new Date()): StockPacket[] {
    this.tick += 1;
    const seconds = Math.floor(now.getTime() / 1000);
    const packets: StockPacket[] = [];
    for (const sender of this.config.nodes) {
      const at = this.positions.get(sender) ?? {
        lat: this.config.startLat,
        lon: this.config.startLon,
      };
      // A step of up to about 1e-4 degrees (11 m) per axis per tick: walking pace at the default
      // 5 s interval, well under monitoring.maxPlausibleSpeedKmh.
      const step = () => randomInt(1, 5) * 0.000025 * (randomInt(0, 2) ? 1 : -1);
      const moved = { lat: at.lat + step(), lon: at.lon + step() };
      this.positions.set(sender, moved);
      packets.push(
        this.packet(sender, seconds, 'position', {
          time: seconds,
          latitude_i: Math.round(moved.lat * 1e7),
          longitude_i: Math.round(moved.lon * 1e7),
          altitude: 1300 + randomInt(0, 60),
        }),
        this.packet(sender, seconds, 'telemetry', {
          battery_level: simulatedBattery(this.tick * (this.config.intervalMs / 1000)),
          voltage: 4.1,
          channel_utilization: 3.5,
          air_util_tx: 0.8,
          uptime_seconds: this.tick * (this.config.intervalMs / 1000),
        }),
      );
    }
    const every = this.config.sosEvery;
    const first = this.config.nodes[0];
    if (every > 0 && first && this.tick % every === 0) {
      const at = this.positions.get(first)!;
      packets.push(
        this.packet(first, seconds, 'text', {
          text: `SOS - [${at.lat.toFixed(6)}], [${at.lon.toFixed(6)}]`,
        }),
      );
    }
    return packets;
  }

  private packet(
    sender: string,
    seconds: number,
    type: StockPacket['type'],
    payload: Record<string, unknown>,
  ): StockPacket {
    return {
      // A fresh 32-bit packet id; the backend deduplicates on (from, id) (D-006).
      id: randomInt(1, 2 ** 31),
      timestamp: seconds,
      to: 0xffffffff,
      from: nodeNum(sender),
      channel: 0,
      type,
      sender,
      payload,
      rssi: -90 - randomInt(0, 15),
      snr: 6.25,
      hops_away: 0,
      hop_start: 3,
    };
  }
}
