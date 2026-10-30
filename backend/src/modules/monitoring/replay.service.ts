import { Injectable } from '@nestjs/common';
import { ParameterService } from '../platform/parameters/parameter.service';
import { StreamRepository } from './stream.repository';
import { WireEntry, toWire } from './stream.service';

// Entries read per round trip while a reconnecting client catches up.
export const REPLAY_BATCH_SIZE = 500;

const HOUR_MS = 3_600_000;

// What a reconnecting client missed (task 2.2, REQ-EVT-02, FR-MON-05). The gateway decides who the
// client is and which organization it may see; this decides whether its cursor is still replayable and
// reads the entries after it, oldest first. `GET /api/telemetry/stream` (task 3.2) uses the same two
// reads for its REST pages.
@Injectable()
export class ReplayService {
  constructor(
    private readonly repository: StreamRepository,
    private readonly parameters: ParameterService,
  ) {}

  // A cursor is expired when entries after it have left the retention window, so a replay would have a
  // hole in it (E04-3). A quiet stream with nothing recent expires only a cursor behind its newest entry.
  async isExpired(after: number, now: Date = new Date()): Promise<boolean> {
    const hours = await this.parameters.get('monitoring.streamRetentionHours');
    const oldest = await this.repository.oldestSeqSince(new Date(now.getTime() - hours * HOUR_MS));
    if (oldest !== null) return after < oldest - 1;
    return after < (await this.repository.maxSeq());
  }

  // Entries after `after` that the scope may see, as the wire form, in `seq` order, at most `limit`. A
  // null scope is the fleet and sees every entry; an id is that organization's own entries.
  async batchAfter(
    organizationId: string | null,
    after: number,
    limit: number = REPLAY_BATCH_SIZE,
  ): Promise<WireEntry[]> {
    const entries = await this.repository.after(organizationId, after, limit);
    return entries.map(toWire);
  }
}
