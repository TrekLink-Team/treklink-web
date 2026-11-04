import { fromBinary, type DescMessage } from '@bufbuild/protobuf';
import { Protobuf } from '@meshtastic/core';
import type { StockPacket } from './simulator';

// The members of a `MeshPacket` (meshtastic mesh.proto, as @meshtastic/core decodes it) the station
// reads. The core's declarations name the protobuf types from a package it does not install, so the
// shape is written out here.
export interface MeshPacketLike {
  id: number;
  from: number;
  to: number;
  channel: number;
  rxTime: number;
  rxSnr: number;
  rxRssi: number;
  hopLimit: number;
  hopStart: number;
  payloadVariant:
    | { case: 'decoded'; value: { portnum: number; payload: Uint8Array } }
    | { case: string | undefined; value?: unknown };
}

interface PositionLike {
  latitudeI?: number;
  longitudeI?: number;
  altitude?: number;
  time: number;
}

interface DeviceMetricsLike {
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
  uptimeSeconds?: number;
}

/** A node number as Meshtastic writes it: `!` and eight lower-case hex digits. */
export const nodeIdOf = (nodeNum: number): string =>
  `!${(nodeNum >>> 0).toString(16).padStart(8, '0')}`;

export type StockResult = { kind: 'packet'; packet: StockPacket } | { kind: 'skipped'; reason: string };

const PORT = Protobuf.Portnums.PortNum as Record<string, number>;
const MESH = Protobuf.Mesh as unknown as Record<string, DescMessage>;
const TELEMETRY = Protobuf.Telemetry as unknown as Record<string, DescMessage>;
const utf8 = new TextDecoder('utf-8');

// Only the members that are set, so a zero or absent field is left out as the serializer leaves it.
const setMembers = (members: Record<string, number | undefined>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(members).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] !== 0,
    ),
  );

const payloadOf = (
  portnum: number,
  bytes: Uint8Array,
): { type: StockPacket['type']; payload: Record<string, unknown> } | { skipped: string } => {
  if (portnum === PORT.TEXT_MESSAGE_APP) {
    return { type: 'text', payload: { text: utf8.decode(bytes) } };
  }
  if (portnum === PORT.POSITION_APP) {
    const position = fromBinary(MESH.PositionSchema, bytes) as unknown as PositionLike;
    if (typeof position.latitudeI !== 'number' || typeof position.longitudeI !== 'number') {
      return { skipped: 'position without coordinates' };
    }
    return {
      type: 'position',
      payload: {
        latitude_i: position.latitudeI,
        longitude_i: position.longitudeI,
        ...setMembers({ altitude: position.altitude, time: position.time }),
      },
    };
  }
  if (portnum === PORT.TELEMETRY_APP) {
    const telemetry = fromBinary(TELEMETRY.TelemetrySchema, bytes) as unknown as {
      variant: { case: string | undefined; value?: unknown };
    };
    if (telemetry.variant.case !== 'deviceMetrics') return { skipped: 'telemetry without device metrics' };
    const metrics = telemetry.variant.value as DeviceMetricsLike;
    return {
      type: 'telemetry',
      payload: setMembers({
        battery_level: metrics.batteryLevel,
        voltage: metrics.voltage,
        channel_utilization: metrics.channelUtilization,
        air_util_tx: metrics.airUtilTx,
        uptime_seconds: metrics.uptimeSeconds,
      }),
    };
  }
  return { skipped: `port number ${portnum}` };
};

/**
 * One decoded packet in the stock JSON shape of the firmware's MQTT serializer (gateway-sync design
 * §3.1, mqtt-ingress-contract.md), with the station's node as `sender`. A packet the station does not
 * forward (still encrypted, another port number, telemetry without device metrics, a position
 * without coordinates) is skipped with the reason (REQ-ERR-08).
 */
export const toStockPacket = (packet: MeshPacketLike, stationNode: number): StockResult => {
  if (packet.payloadVariant.case !== 'decoded') {
    return { kind: 'skipped', reason: 'encrypted packet' };
  }
  const data = packet.payloadVariant.value as { portnum: number; payload: Uint8Array };
  let body: ReturnType<typeof payloadOf>;
  try {
    body = payloadOf(data.portnum, data.payload);
  } catch (error) {
    return { kind: 'skipped', reason: `undecodable payload: ${(error as Error).message}` };
  }
  if ('skipped' in body) return { kind: 'skipped', reason: body.skipped };
  return {
    kind: 'packet',
    packet: {
      id: packet.id,
      timestamp: packet.rxTime,
      to: packet.to,
      from: packet.from,
      channel: packet.channel,
      type: body.type,
      sender: nodeIdOf(stationNode),
      payload: body.payload,
      ...setMembers({ rssi: packet.rxRssi, snr: packet.rxSnr }),
      ...(packet.hopStart > 0
        ? { hops_away: packet.hopStart - packet.hopLimit, hop_start: packet.hopStart }
        : {}),
    },
  };
};
