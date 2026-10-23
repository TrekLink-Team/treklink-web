import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngressPath } from '@prisma/client';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { AdaptResult, INGESTED_TYPES, IngestedType, StockPacket } from '../canonical-envelope';

const UINT32_MAX = 0xffffffff;
const isUint32 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Stage A and B: `<root>/2/json/<channelId>/<nodeId>`, published by a node's own uplink (task 2.1,
// mqtt-ingress-contract.md). Translates topic and envelope only; payloads are the strategies' job.
@Injectable()
export class NodeJsonAdapter {
  private readonly topic: RegExp;
  readonly subscription: string;

  constructor(config: ConfigService<ValidatedEnvironment, true>) {
    const root = config.get('MQTT_ROOT', { infer: true });
    this.topic = new RegExp(`^${root}/2/json/[^/]+/(![0-9a-fA-F]{8})$`);
    this.subscription = `${root}/2/json/+/+`;
  }

  adapt(topic: string, body: Buffer, receivedAt: Date): AdaptResult {
    const match = this.topic.exec(topic);
    if (!match) return { kind: 'ignored', reason: `topic ${topic} is not a node JSON topic` };
    const uplinkKey = match[1].toLowerCase();
    const malformed = (detail: string, raw: unknown): AdaptResult => ({
      kind: 'malformed',
      ingress: IngressPath.MQTT_NODE,
      uplinkKey,
      detail,
      raw,
    });

    const text = body.toString('utf8');
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return malformed('message is not JSON', text);
    }
    if (!isObject(message)) return malformed('message is not a JSON object', message);

    // Any type ingestion does not read, including the empty type of an unlisted PortNum, is ignored
    // without an audit row (contract, Message table).
    const type = message.type;
    if (typeof type !== 'string') return malformed('type is missing', message);
    if (!(INGESTED_TYPES as readonly string[]).includes(type)) {
      return { kind: 'ignored', reason: `type ${JSON.stringify(type)} is not ingested` };
    }

    for (const field of ['id', 'from', 'timestamp'] as const) {
      if (!isUint32(message[field]))
        return malformed(`${field} is not an unsigned 32-bit integer`, message);
    }
    if (typeof message.sender !== 'string') return malformed('sender is missing', message);
    if (!isObject(message.payload)) return malformed('payload is missing', message);

    const packet: StockPacket = {
      id: message.id as number,
      from: message.from as number,
      timestamp: message.timestamp as number,
      type: type as IngestedType,
      sender: message.sender,
      payload: message.payload,
      ...(typeof message.rssi === 'number' ? { rssi: message.rssi } : {}),
      ...(typeof message.snr === 'number' ? { snr: message.snr } : {}),
      ...(typeof message.hops_away === 'number' ? { hops_away: message.hops_away } : {}),
    };
    return {
      kind: 'envelope',
      envelope: { ingress: IngressPath.MQTT_NODE, uplinkKey, receivedAt, packet, message },
    };
  }
}
