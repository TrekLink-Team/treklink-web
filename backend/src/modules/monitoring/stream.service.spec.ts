import { StreamEntry, StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

const stored = (organizationId: string | null): StreamEntry => ({
  seq: 7,
  organizationId,
  type: 'device.position',
  deviceId: 'd-1',
  payload: { lat: 11.5 },
  createdAt: '2026-10-25T03:00:00.000Z',
});

describe('StreamService', () => {
  let repository: { insert: jest.Mock };
  let service: StreamService;

  beforeEach(() => {
    repository = { insert: jest.fn() };
    service = new StreamService(repository as unknown as StreamRepository);
  });

  it('stores the entry, then publishes it to the fleet and the organization room', async () => {
    repository.insert.mockResolvedValue(stored('o-1'));
    const seen: [string[], unknown][] = [];
    service.subscribe((rooms, entry) => seen.push([rooms, entry]));

    await service.publish({
      organizationId: 'o-1',
      type: 'device.position',
      payload: { lat: 11.5 },
    });

    expect(seen).toEqual([
      [
        ['fleet', 'org:o-1'],
        {
          seq: 7,
          type: 'device.position',
          deviceId: 'd-1',
          payload: { lat: 11.5 },
          createdAt: '2026-10-25T03:00:00.000Z',
        },
      ],
    ]);
  });

  it('keeps the organization off the wire entry', async () => {
    repository.insert.mockResolvedValue(stored('o-1'));
    const entries: object[] = [];
    service.subscribe((_rooms, entry) => entries.push(entry));
    await service.publish({ organizationId: 'o-1', type: 'device.position', payload: {} });
    expect(entries[0]).not.toHaveProperty('organizationId');
  });

  it('sends an UNATTRIBUTED entry to the fleet only', async () => {
    repository.insert.mockResolvedValue(stored(null));
    const rooms: string[][] = [];
    service.subscribe((r) => rooms.push(r));
    await service.publish({ organizationId: null, type: 'device.position', payload: {} });
    expect(rooms).toEqual([['fleet']]);
  });

  it('does not publish an entry that failed to store', async () => {
    repository.insert.mockRejectedValue(new Error('db down'));
    const subscriber = jest.fn();
    service.subscribe(subscriber);
    await expect(
      service.publish({ organizationId: 'o-1', type: 'device.position', payload: {} }),
    ).rejects.toThrow('db down');
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('isolates a failing subscriber from the others and from the caller', async () => {
    repository.insert.mockResolvedValue(stored('o-1'));
    const later = jest.fn();
    service.subscribe(() => {
      throw new Error('socket closed');
    });
    service.subscribe(later);
    await expect(
      service.publish({ organizationId: 'o-1', type: 'device.position', payload: {} }),
    ).resolves.toMatchObject({ seq: 7 });
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a subscriber that unsubscribed', async () => {
    repository.insert.mockResolvedValue(stored('o-1'));
    const subscriber = jest.fn();
    const unsubscribe = service.subscribe(subscriber);
    unsubscribe();
    await service.publish({ organizationId: 'o-1', type: 'device.position', payload: {} });
    expect(subscriber).not.toHaveBeenCalled();
  });
});
