import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngressPath } from '@prisma/client';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { AdaptResult } from '../canonical-envelope';
import { decodeStock } from './stock-json';

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

    const decoded = decodeStock(body);
    if (decoded.kind === 'ignored') return decoded;
    if (decoded.kind === 'malformed') {
      return { ...decoded, ingress: IngressPath.MQTT_NODE, uplinkKey };
    }
    const { packet, message } = decoded;
    return {
      kind: 'envelope',
      envelope: { ingress: IngressPath.MQTT_NODE, uplinkKey, receivedAt, packet, message },
    };
  }
}
