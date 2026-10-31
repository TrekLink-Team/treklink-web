import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngressPath } from '@prisma/client';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { AdaptResult } from '../canonical-envelope';
import { decodeStock } from './stock-json';

const isEpochMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

// Stage C: `<root>/fs/<mqttUsername>/2/json/<channelId>/<nodeId>`, a Field Station republishing what
// its USB node heard (task 2.1, mqtt-ingress-contract.md). The username in the topic names the
// station; the broker ACL lets a station publish only under its own username. The stock JSON carries
// two extra top-level fields, `fs_captured_at` and `fs_sent_at` (station clock, epoch ms), which the
// envelope keeps apart from the packet for the STATION_CORRECTED occurrence time (REQ-UBI-06).
// Translates topic and envelope only; `IngestionService` resolves the station.
@Injectable()
export class FieldStationJsonAdapter {
  private readonly topic: RegExp;
  readonly subscription: string;

  constructor(config: ConfigService<ValidatedEnvironment, true>) {
    const root = config.get('MQTT_ROOT', { infer: true });
    this.topic = new RegExp(`^${root}/fs/([^/]+)/2/json/[^/]+/(![0-9a-fA-F]{8})$`);
    this.subscription = `${root}/fs/+/2/json/+/+`;
  }

  adapt(topic: string, body: Buffer, receivedAt: Date): AdaptResult {
    const match = this.topic.exec(topic);
    if (!match) {
      return { kind: 'ignored', reason: `topic ${topic} is not a Field Station JSON topic` };
    }
    const uplinkKey = match[1];

    const decoded = decodeStock(body);
    if (decoded.kind === 'ignored') return decoded;
    if (decoded.kind === 'malformed') {
      return { ...decoded, ingress: IngressPath.FIELD_STATION, uplinkKey };
    }
    const { packet, message } = decoded;
    for (const field of ['fs_captured_at', 'fs_sent_at'] as const) {
      if (!isEpochMs(message[field])) {
        return {
          kind: 'malformed',
          ingress: IngressPath.FIELD_STATION,
          uplinkKey,
          detail: `${field} is not a positive epoch millisecond time`,
          raw: message,
        };
      }
    }
    return {
      kind: 'envelope',
      envelope: {
        ingress: IngressPath.FIELD_STATION,
        uplinkKey,
        receivedAt,
        packet,
        message,
        station: {
          capturedAtMs: message.fs_captured_at as number,
          sentAtMs: message.fs_sent_at as number,
        },
      },
    };
  }
}
