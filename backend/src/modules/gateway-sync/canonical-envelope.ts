import { IngressPath } from '@prisma/client';

// The types the stock serializer emits that ingestion reads (mqtt-ingress-contract.md, Message).
export const INGESTED_TYPES = ['text', 'position', 'telemetry'] as const;
export type IngestedType = (typeof INGESTED_TYPES)[number];

// One stock Meshtastic JSON publish after envelope validation (MeshPacketSerializer.cpp:440-454).
export interface StockPacket {
  id: number;
  from: number;
  timestamp: number; // the uplinking node's rx_time; 0 = no valid RTC
  type: IngestedType;
  sender: string;
  payload: Record<string, unknown>;
  rssi?: number;
  snr?: number;
  hops_away?: number;
}

// The two fields a Field Station adds to the stock JSON (mqtt-ingress-contract.md, Message), both
// the station clock in epoch milliseconds: when the packet came off the serial port, and this publish.
export interface StationTimes {
  capturedAtMs: number; // fs_captured_at
  sentAtMs: number; // fs_sent_at
}

// What every adapter produces (design §2, D-007): the packet plus where and when it arrived.
export interface CanonicalEnvelope {
  ingress: IngressPath;
  uplinkKey: string; // the publishing node id, or the Field Station username (Stage C)
  receivedAt: Date;
  packet: StockPacket;
  message: Record<string, unknown>; // the JSON as published, persisted on the field event
  station?: StationTimes; // Stage C only
}

export type AdaptResult =
  | { kind: 'envelope'; envelope: CanonicalEnvelope }
  | {
      kind: 'malformed';
      ingress: IngressPath;
      uplinkKey: string | null;
      detail: string;
      raw: unknown;
    }
  | { kind: 'ignored'; reason: string };
