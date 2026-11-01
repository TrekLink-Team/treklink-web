import { PriorityTier } from '../config';
import type { HeardFrame } from '../serial/serial-reader';

// The SOS strings of TrekLinkSOSHelper.h:19-20, the same prefixes the backend's text strategy reads
// (backend/src/modules/gateway-sync/normalizer/text.strategy.ts). The fall prefix starts with the plain one,
// so it is tested first.
export const SOS_PREFIX = 'SOS - ';
export const FALL_SOS_PREFIX = 'SOS - FALL DETECTED';

export type LocalEventKind = 'POSITION' | 'TELEMETRY' | 'SOS' | 'FALL_SOS' | 'TEXT' | 'OTHER';

/** One decoded event in the page's log (`/local/events`). */
export interface LocalEvent {
  /** This process's own sequence, from 1, so the page can ask for what came after the last one it has. */
  localSeq: number;
  eventId: string;
  nodeId: string;
  kind: LocalEventKind;
  tier: PriorityTier;
  heardAt: number;
  /** A short human-readable line: coordinates, battery level or the text. */
  summary: string;
}

export interface LocalPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** Station clock, epoch ms, when the position was heard. */
  heardAt: number;
}

export interface LocalBattery {
  level: number | null;
  voltage: number | null;
  heardAt: number;
}

/** One node as `/local/nodes` returns it. */
export interface LocalNode {
  nodeId: string;
  lastHeardAt: number;
  position: LocalPosition | null;
  battery: LocalBattery | null;
  sosActive: boolean;
  sosKind: 'SOS' | 'FALL_SOS' | null;
  lastSosAt: number | null;
  stale: boolean;
}

interface NodeRecord {
  nodeId: string;
  lastHeardAt: number;
  position: LocalPosition | null;
  battery: LocalBattery | null;
  sosKind: 'SOS' | 'FALL_SOS' | null;
  lastSosAt: number | null;
}

interface StockLike {
  type?: unknown;
  sender?: unknown;
  payload?: Record<string, unknown>;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The kind of a stock packet: the same rule the backend uses for text, the packet type otherwise. */
export const kindOf = (packet: StockLike): LocalEventKind => {
  if (packet.type === 'position') return 'POSITION';
  if (packet.type === 'telemetry') return 'TELEMETRY';
  if (packet.type === 'text') {
    const text = packet.payload?.text;
    if (typeof text !== 'string') return 'TEXT';
    if (text.startsWith(FALL_SOS_PREFIX)) return 'FALL_SOS';
    if (text.startsWith(SOS_PREFIX)) return 'SOS';
    return 'TEXT';
  }
  return 'OTHER';
};

/**
 * What the Field Station has heard since it started, held in memory for the local page
 * (field-station-local-page.md, REQ-STA-02). It is fed by the serial reader after each enqueue and read by
 * the local API; nothing here touches the network or the queue, so the page answers with the uplink down.
 *
 * `sosActive` is a display aid for the people on site (D-038): once a node's SOS or fall SOS is heard it
 * stays set for the life of the process. The firmware's cancel text is not consumed (D-038) and the local
 * clear of the contract is not built yet, so no traffic clears it.
 */
export class StationState {
  private readonly nodeRecords = new Map<string, NodeRecord>();
  private readonly log: LocalEvent[] = [];
  private seq = 0;

  constructor(private readonly options: { staleSeconds: number; eventLogSize: number }) {}

  /** Records one frame the reader handed to the queue. A frame without a sender is logged as unknown. */
  public record(frame: HeardFrame): void {
    const packet = frame.payload as StockLike;
    const nodeId =
      typeof packet.sender === 'string' && packet.sender !== '' ? packet.sender : 'unknown';
    const kind = kindOf(packet);
    const payload = packet.payload ?? {};
    const node = this.nodeRecords.get(nodeId) ?? {
      nodeId,
      lastHeardAt: frame.heardAt,
      position: null,
      battery: null,
      sosKind: null,
      lastSosAt: null,
    };
    node.lastHeardAt = Math.max(node.lastHeardAt, frame.heardAt);

    let summary: string;
    if (kind === 'POSITION') {
      const lat = num(payload.latitude_i);
      const lon = num(payload.longitude_i);
      if (lat !== null && lon !== null) {
        node.position = {
          latitude: lat / 1e7,
          longitude: lon / 1e7,
          altitude: num(payload.altitude),
          heardAt: frame.heardAt,
        };
        summary = `${node.position.latitude.toFixed(5)}, ${node.position.longitude.toFixed(5)}`;
      } else {
        summary = 'position without coordinates';
      }
    } else if (kind === 'TELEMETRY') {
      const level = num(payload.battery_level);
      const voltage = num(payload.voltage);
      // Telemetry without a battery reading (environment metrics) leaves the last battery as it was.
      if (level !== null || voltage !== null)
        node.battery = { level, voltage, heardAt: frame.heardAt };
      summary = level !== null ? `battery ${level}%` : 'telemetry';
    } else if (kind === 'SOS' || kind === 'FALL_SOS') {
      node.sosKind = kind;
      node.lastSosAt = frame.heardAt;
      summary = String(payload.text);
    } else if (kind === 'TEXT') {
      summary = typeof payload.text === 'string' ? payload.text : 'text';
    } else {
      summary = typeof packet.type === 'string' ? packet.type : 'unknown packet';
    }
    this.nodeRecords.set(nodeId, node);

    this.seq += 1;
    this.log.push({
      localSeq: this.seq,
      eventId: frame.eventId,
      nodeId,
      kind,
      tier: frame.priority,
      heardAt: frame.heardAt,
      summary,
    });
    if (this.log.length > this.options.eventLogSize)
      this.log.splice(0, this.log.length - this.options.eventLogSize);
  }

  /** Every node heard, SOS first, then by node id. */
  public nodes(now: number = Date.now()): LocalNode[] {
    const staleMs = this.options.staleSeconds * 1000;
    return [...this.nodeRecords.values()]
      .map((node) => ({
        nodeId: node.nodeId,
        lastHeardAt: node.lastHeardAt,
        position: node.position,
        battery: node.battery,
        sosActive: node.sosKind !== null,
        sosKind: node.sosKind,
        lastSosAt: node.lastSosAt,
        stale: now - node.lastHeardAt > staleMs,
      }))
      .sort(
        (a, b) => Number(b.sosActive) - Number(a.sosActive) || a.nodeId.localeCompare(b.nodeId),
      );
  }

  /** The events after `after` (exclusive) still in the log, oldest first, newest last. */
  public events(after = 0): LocalEvent[] {
    return this.log.filter((event) => event.localSeq > after);
  }

  /** The newest `localSeq` given out, 0 before the first frame. */
  public lastSeq(): number {
    return this.seq;
  }
}
