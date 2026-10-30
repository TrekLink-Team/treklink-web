import { ParameterService } from '../platform/parameters/parameter.service';
import { StreamListener } from './stream.listener';
import { StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

const NOW = new Date('2026-10-28T03:00:00.000Z');
const AT = '2026-10-28T02:59:00.000Z';

describe('StreamListener', () => {
  let published: Record<string, unknown>[];
  let stream: { publish: jest.Mock };
  let repository: { latestRelease: jest.Mock; recordRelease: jest.Mock };
  let interval: number;
  let listener: StreamListener;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    published = [];
    stream = {
      publish: jest.fn((entry: Record<string, unknown>) => {
        published.push(entry);
        return Promise.resolve({ seq: published.length });
      }),
    };
    repository = {
      latestRelease: jest.fn().mockResolvedValue(null),
      recordRelease: jest.fn().mockResolvedValue(undefined),
    };
    interval = 1000;
    const parameters = { get: jest.fn(() => Promise.resolve(interval)) };
    listener = new StreamListener(
      stream as unknown as StreamService,
      repository as unknown as StreamRepository,
      parameters as unknown as ParameterService,
    );
  });

  afterEach(() => jest.useRealTimers());

  const position = (overrides: Record<string, unknown> = {}) => ({
    deviceId: 'd-1',
    organizationId: 'org-a',
    lat: 11.56,
    lon: 108.54,
    at: AT,
    plotted: true,
    ...overrides,
  });

  describe('field.position', () => {
    it('publishes the position to the organization the event names (AC-01)', async () => {
      await listener.onFieldPosition(position());
      expect(published).toEqual([
        {
          organizationId: 'org-a',
          type: 'device.position',
          deviceId: 'd-1',
          payload: { lat: 11.56, lon: 108.54, at: AT },
        },
      ]);
    });

    it('never publishes a position marked not plotted (AC-04, REQ-UBI-03)', async () => {
      await listener.onFieldPosition(position({ plotted: false }));
      expect(published).toEqual([]);
    });

    it('sends an UNATTRIBUTED position with no organization, so it reaches the fleet only', async () => {
      await listener.onFieldPosition(position({ organizationId: null }));
      expect(published[0]).toMatchObject({ organizationId: null, type: 'device.position' });
      expect(repository.latestRelease).not.toHaveBeenCalled();
    });

    it('throttles positions per device to the configured interval', async () => {
      await listener.onFieldPosition(position());
      await listener.onFieldPosition(position({ lat: 11.57 }));
      expect(published).toHaveLength(1);

      await listener.onFieldPosition(position({ deviceId: 'd-2' }));
      expect(published).toHaveLength(2);

      jest.advanceTimersByTime(1000);
      await listener.onFieldPosition(position({ lat: 11.58 }));
      expect(published).toHaveLength(3);
    });

    it('does not throttle at all when the interval is 0', async () => {
      interval = 0;
      await listener.onFieldPosition(position());
      await listener.onFieldPosition(position());
      expect(published).toHaveLength(2);
    });

    it("flags a position that occurred before the organization's check-in as late, and does not throttle it (AC-06)", async () => {
      repository.latestRelease.mockResolvedValue(new Date('2026-10-28T03:00:00.000Z'));
      await listener.onFieldPosition(position());
      await listener.onFieldPosition(position({ lat: 11.57 }));
      expect(published).toHaveLength(2);
      expect(published[0]).toMatchObject({
        organizationId: 'org-a',
        payload: { lat: 11.56, lon: 108.54, at: AT, late: true },
      });
    });

    it('leaves a position from a later custody of the same organization unflagged', async () => {
      repository.latestRelease.mockResolvedValue(new Date('2026-10-20T00:00:00.000Z'));
      await listener.onFieldPosition(position());
      expect(published[0].payload).not.toHaveProperty('late');
    });

    it('reads the latest check-in once per organization and device', async () => {
      await listener.onFieldPosition(position());
      jest.advanceTimersByTime(1000);
      await listener.onFieldPosition(position());
      expect(repository.latestRelease).toHaveBeenCalledTimes(1);
      expect(repository.latestRelease).toHaveBeenCalledWith('org-a', 'd-1');
    });
  });

  describe('field.telemetry', () => {
    it('publishes the battery to the named organization', async () => {
      await listener.onFieldTelemetry({
        deviceId: 'd-1',
        organizationId: 'org-a',
        batteryPct: 81,
        at: AT,
      });
      expect(published).toEqual([
        {
          organizationId: 'org-a',
          type: 'device.telemetry',
          deviceId: 'd-1',
          payload: { batteryPct: 81, at: AT },
        },
      ]);
    });

    it('flags a late reading', async () => {
      repository.latestRelease.mockResolvedValue(new Date('2026-10-28T03:00:00.000Z'));
      await listener.onFieldTelemetry({
        deviceId: 'd-1',
        organizationId: 'org-a',
        batteryPct: 40,
        at: AT,
      });
      expect(published[0].payload).toEqual({ batteryPct: 40, at: AT, late: true });
    });

    it('is not throttled, because only positions are', async () => {
      const event = { deviceId: 'd-1', organizationId: 'org-a', batteryPct: 81, at: AT };
      await listener.onFieldTelemetry(event);
      await listener.onFieldTelemetry(event);
      expect(published).toHaveLength(2);
    });
  });

  describe('device.checkedIn', () => {
    const checkedIn = { deviceId: 'd-1', contractId: 'c-1', organizationId: 'org-a', at: NOW };

    it('emits device.released to the organization with the contract and the check-in time (AC-05)', async () => {
      await listener.onDeviceCheckedIn({ ...checkedIn, at: new Date('2026-10-28T02:58:00.000Z') });
      expect(published).toEqual([
        {
          organizationId: 'org-a',
          type: 'device.released',
          deviceId: 'd-1',
          payload: { contractId: 'c-1', checkedInAt: '2026-10-28T02:58:00.000Z' },
        },
      ]);
    });

    it('records the check-in durably before it publishes device.released', async () => {
      const order: string[] = [];
      repository.recordRelease.mockImplementation(() => {
        order.push('record');
        return Promise.resolve();
      });
      stream.publish.mockImplementation(() => {
        order.push('publish');
        return Promise.resolve({ seq: 1 });
      });
      await listener.onDeviceCheckedIn({ ...checkedIn, at: new Date('2026-10-28T02:58:00.000Z') });
      expect(order).toEqual(['record', 'publish']);
      expect(repository.recordRelease).toHaveBeenCalledWith(
        'org-a',
        'd-1',
        new Date('2026-10-28T02:58:00.000Z'),
      );
    });

    it('publishes nothing when the check-in cannot be recorded, so the event is not half applied', async () => {
      repository.recordRelease.mockRejectedValue(new Error('db down'));
      await expect(listener.onDeviceCheckedIn(checkedIn)).rejects.toThrow('db down');
      expect(published).toEqual([]);
    });

    it('flags a late upload from the stored boundary after a restart, days after the stream entry is gone', async () => {
      repository.latestRelease.mockResolvedValue(new Date('2026-10-23T00:00:00.000Z'));
      await listener.onFieldPosition(position({ at: '2026-10-22T12:00:00.000Z' }));
      expect(published[0].payload).toMatchObject({ late: true });
    });

    it('flags the next event that occurred before the check-in as late without a lookup (AC-06)', async () => {
      await listener.onDeviceCheckedIn({ ...checkedIn, at: new Date('2026-10-28T03:00:00.000Z') });
      await listener.onFieldPosition(position());
      expect(repository.latestRelease).not.toHaveBeenCalled();
      expect(published[1].payload).toMatchObject({ late: true });
    });

    it('lets the first position of a new custody through after a check-in', async () => {
      await listener.onFieldPosition(position({ at: '2026-10-28T02:00:00.000Z' }));
      await listener.onDeviceCheckedIn({ ...checkedIn, at: new Date('2026-10-28T02:30:00.000Z') });
      await listener.onFieldPosition(position({ at: '2026-10-28T02:45:00.000Z' }));
      expect(published[2].payload).not.toHaveProperty('late');
    });

    it('does not tell another organization about the check-in (AC-01)', async () => {
      await listener.onDeviceCheckedIn(checkedIn);
      await listener.onFieldPosition(position({ organizationId: 'org-b' }));
      expect(published.map((entry) => entry.organizationId)).toEqual(['org-a', 'org-b']);
      expect(published[1].payload).not.toHaveProperty('late');
    });
  });

  describe('device.handedOver', () => {
    it("tells the receiving organization's map that the device has arrived", async () => {
      await listener.onDeviceHandedOver({
        deviceId: 'd-1',
        contractId: 'c-1',
        organizationId: 'org-b',
        at: new Date(AT),
      });
      expect(published).toEqual([
        {
          organizationId: 'org-b',
          type: 'device.handedOver',
          deviceId: 'd-1',
          payload: { contractId: 'c-1', at: AT },
        },
      ]);
    });
  });

  describe('device.labelChanged', () => {
    it('publishes only the holder name, never a phone number', async () => {
      await listener.onDeviceLabelChanged({
        deviceId: 'd-1',
        contractId: 'c-1',
        organizationId: 'org-a',
        holder: { name: 'Le Thi E' },
        at: AT,
      } as never);
      expect(published).toEqual([
        {
          organizationId: 'org-a',
          type: 'device.label',
          deviceId: 'd-1',
          payload: { holder: { name: 'Le Thi E' } },
        },
      ]);
    });

    it('publishes a cleared label as null', async () => {
      await listener.onDeviceLabelChanged({
        deviceId: 'd-1',
        contractId: 'c-1',
        organizationId: 'org-a',
        holder: null,
        at: AT,
      } as never);
      expect(published[0].payload).toEqual({ holder: null });
    });
  });

  describe('incident.changed', () => {
    it('publishes the incident with its device to its routed organization', async () => {
      await listener.onIncidentChanged({
        incidentId: 'inc-1',
        deviceId: 'dev-1',
        organizationId: 'org-a',
        state: 'ACKNOWLEDGED',
        tier: 'PRIMARY',
        ownerId: 'u-1',
      });
      expect(published).toEqual([
        {
          organizationId: 'org-a',
          type: 'incident.changed',
          deviceId: 'dev-1',
          payload: { incidentId: 'inc-1', state: 'ACKNOWLEDGED', tier: 'PRIMARY', ownerId: 'u-1' },
        },
      ]);
    });

    it('publishes an event that names no device with a null device id', async () => {
      await listener.onIncidentChanged({
        incidentId: 'inc-3',
        organizationId: 'org-a',
        state: 'ACKNOWLEDGED',
        tier: null,
        ownerId: null,
      });
      expect(published[0]).toMatchObject({ deviceId: null });
      expect(published[0].payload).toEqual({
        incidentId: 'inc-3',
        state: 'ACKNOWLEDGED',
        tier: null,
        ownerId: null,
      });
    });

    it('sends an unrouted incident to the fleet only', async () => {
      await listener.onIncidentChanged({
        incidentId: 'inc-2',
        organizationId: null,
        state: 'UNROUTED',
        tier: null,
        ownerId: null,
      });
      expect(published[0]).toMatchObject({ organizationId: null });
    });
  });
});
