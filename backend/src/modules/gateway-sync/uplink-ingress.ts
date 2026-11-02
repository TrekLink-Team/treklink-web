import { Injectable } from '@nestjs/common';
import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { IngestionService } from './ingestion.service';

export type UplinkOutcome = 'ignored' | 'malformed' | 'ingested';

// `simulated` marks every field event of the packet as ingested by the field simulation (specs/demo/design.md
// §9); the MQTT and Field Station paths never set it.
export interface UplinkOptions {
  simulated?: boolean;
}

// One node uplink message through the same adapter and ingestion as the MQTT subscriber (design §2), without
// a broker. Exported for the demo module's `sos-open` scenario (D-088), which ingests the `sos` fixture
// as `replay:mqtt -- sos --now --new-ids` would publish it, and for the field simulation (D-093
// amendment), which passes `{ simulated: true }`.
@Injectable()
export class UplinkIngress {
  constructor(
    private readonly adapter: NodeJsonAdapter,
    private readonly ingestion: IngestionService,
  ) {}

  async ingest(
    topic: string,
    body: Buffer,
    receivedAt: Date = new Date(),
    options: UplinkOptions = {},
  ): Promise<UplinkOutcome> {
    const result = this.adapter.adapt(topic, body, receivedAt);
    if (result.kind === 'ignored') return 'ignored';
    if (result.kind === 'malformed') {
      await this.ingestion.rejectMalformed(
        result.ingress,
        result.uplinkKey,
        result.detail,
        result.raw,
      );
      return 'malformed';
    }
    await this.ingestion.ingest(
      options.simulated ? { ...result.envelope, simulated: true } : result.envelope,
    );
    return 'ingested';
  }
}
