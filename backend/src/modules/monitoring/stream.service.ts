import { Injectable } from '@nestjs/common';
import { NewStreamEntry, StreamEntry, StreamRepository } from './stream.repository';
import { roomsFor } from './rooms';

// The wire form of an entry: what a client receives as the `stream` event (ws-live-contract). The
// organization stays on the server; rooms carry the scoping.
export type WireEntry = Pick<StreamEntry, 'seq' | 'type' | 'deviceId' | 'payload' | 'createdAt'>;

export type StreamSubscriber = (rooms: string[], entry: WireEntry) => void;

const toWire = ({ seq, type, deviceId, payload, createdAt }: StreamEntry): WireEntry => ({
  seq,
  type,
  deviceId,
  payload,
  createdAt,
});

// Stores a stream entry, then hands it to the subscribers with the rooms that may see it. The gateway
// subscribes, so the service never depends on it. A subscriber that throws does not lose the entry:
// it is stored first and a reconnecting client replays it (REQ-EVT-02).
@Injectable()
export class StreamService {
  private readonly subscribers = new Set<StreamSubscriber>();

  constructor(private readonly repository: StreamRepository) {}

  subscribe(subscriber: StreamSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async publish(entry: NewStreamEntry): Promise<StreamEntry> {
    const stored = await this.repository.insert(entry);
    const rooms = roomsFor(stored.organizationId);
    for (const subscriber of this.subscribers) {
      try {
        subscriber(rooms, toWire(stored));
      } catch {
        // Isolated from the other subscribers and from the caller.
      }
    }
    return stored;
  }
}
