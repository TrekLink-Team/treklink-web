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

// What every adapter produces (design §2, D-007): the packet plus where and when it arrived.
export interface CanonicalEnvelope {
  ingress: IngressPath;
  uplinkKey: string; // the publishing node id, or the Field Station username (Stage C)
  receivedAt: Date;
  packet: StockPacket;
  message: Record<string, unknown>; // the stock JSON verbatim, persisted on the field event
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
