import { Injectable } from '@nestjs/common';
import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { IngestionService } from './ingestion.service';

export type UplinkOutcome = 'ignored' | 'malformed' | 'ingested';

// One node uplink message through the same adapter and ingestion as the MQTT subscriber (design §2), without
// a broker. Exported for the demo module's `sos-open` scenario (D-088), which ingests the `sos` fixture
// as `replay:mqtt -- sos --now --new-ids` would publish it.
@Injectable()
export class UplinkIngress {
  constructor(
    private readonly adapter: NodeJsonAdapter,
    private readonly ingestion: IngestionService,
  ) {}

  async ingest(topic: string, body: Buffer, receivedAt: Date = new Date()): Promise<UplinkOutcome> {
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
    await this.ingestion.ingest(result.envelope);
    return 'ingested';
  }
}
