import { SyncOutcome } from '@prisma/client';
import { FieldStationsService } from '../organizations';
import { ParameterService } from '../platform/parameters/parameter.service';
import { MqttConnectionState } from './mqtt/mqtt-connection-state';
import { SyncQueryRepository } from './sync-query.repository';
import { connectionOf, depthOf, SyncStatusService } from './sync-status.service';

const now = new Date('2026-11-01T03:20:00.000Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

const station = (overrides: Record<string, unknown> = {}) => ({
  id: 'fs-1',
  name: 'Ta Nang basecamp laptop',
  mqttUsername: 'fs-org-0001-1',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'TrekLink Demo Tours Co., Ltd.' },
  lastSyncAt: ago(30),
  lastFlushAt: ago(35),
  queueDepth: [0, 0, 2, 9],
  oldestRetryCount: 0,
  version: '0.1.0',
  ...overrides,
});

describe('connectionOf and depthOf', () => {
  it('is CONNECTED inside the stale threshold, STALE past it, NEVER_REPORTED with no report', () => {
    expect(connectionOf(ago(180), now, 180)).toBe('CONNECTED');
    expect(connectionOf(ago(181), now, 180)).toBe('STALE');
    expect(connectionOf(null, now, 180)).toBe('NEVER_REPORTED');
  });

  it('names the depth per priority and reads a short array as zeros', () => {
    expect(depthOf([1, 2, 3, 4])).toEqual({ p0: 1, p1: 2, p2: 3, p3: 4 });
    expect(depthOf([])).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0 });
  });
});

describe('SyncStatusService.status (api-design 07)', () => {
  let repository: { outcomesSince: jest.Mock; lastReceivedAt: jest.Mock };
  let stations: { activeWithHealth: jest.Mock };
  let parameters: { get: jest.Mock };
  const service = (probe?: MqttConnectionState | null) =>
    new SyncStatusService(
      repository as unknown as SyncQueryRepository,
      stations as unknown as FieldStationsService,
      parameters as unknown as ParameterService,
      probe,
    );

  beforeEach(() => {
    repository = {
      outcomesSince: jest.fn().mockResolvedValue(
        new Map([
          [SyncOutcome.ACCEPTED, 26],
          [SyncOutcome.ACCEPTED_UNATTRIBUTED, 1],
          [SyncOutcome.DUPLICATE_REJECTED, 10],
          [SyncOutcome.UNKNOWN_DEVICE, 2],
          [SyncOutcome.MALFORMED_ENVELOPE, 3],
          [SyncOutcome.NORMALIZATION_FAILED, 4],
        ]),
      ),
      lastReceivedAt: jest.fn().mockResolvedValue(ago(5)),
    };
    stations = {
      activeWithHealth: jest
        .fn()
        .mockResolvedValue([station(), station({ id: 'fs-2', lastSyncAt: null, queueDepth: [] })]),
    };
    parameters = { get: jest.fn().mockResolvedValue(180) };
  });

  it('reports the broker, each station and the window outcomes', async () => {
    const probe = new MqttConnectionState();
    probe.set(true);
    const result = await service(probe).status({ op: 'syncStatus' }, now);

    expect(parameters.get).toHaveBeenCalledWith('monitoring.fieldStationStaleSeconds');
    expect(repository.outcomesSince).toHaveBeenCalledWith(ago(3600));
    expect(result.broker).toEqual({ subscriber: 'up' });
    expect(result.staleAfterSeconds).toBe(180);
    expect(result.fieldStations[0]).toEqual({
      id: 'fs-1',
      name: 'Ta Nang basecamp laptop',
      mqttUsername: 'fs-org-0001-1',
      organization: { id: 'org-1', code: 'ORG-0001', name: 'TrekLink Demo Tours Co., Ltd.' },
      connection: 'CONNECTED',
      lastSyncAt: ago(30),
      lastFlushAt: ago(35),
      queueDepth: { p0: 0, p1: 0, p2: 2, p3: 9 },
      oldestRetryCount: 0,
      version: '0.1.0',
    });
    expect(result.fieldStations[1]).toMatchObject({
      connection: 'NEVER_REPORTED',
      queueDepth: { p0: 0, p1: 0, p2: 0, p3: 0 },
    });
    expect(result.ingestion).toEqual({
      windowMinutes: 60,
      accepted: 26,
      acceptedUnattributed: 1,
      duplicates: 10,
      malformed: 3,
      normalizationFailed: 4,
      unknownDevice: 2,
      lastReceivedAt: ago(5),
    });
  });

  it('reads zero for an outcome the window does not hold', async () => {
    repository.outcomesSince.mockResolvedValue(new Map([[SyncOutcome.ACCEPTED, 1]]));
    const { ingestion } = await service(null).status({ op: 'syncStatus' }, now);
    expect(ingestion).toMatchObject({
      accepted: 1,
      acceptedUnattributed: 0,
      duplicates: 0,
      malformed: 0,
      normalizationFailed: 0,
      unknownDevice: 0,
    });
  });

  it('uses the requested window', async () => {
    const result = await service(null).status({ op: 'syncStatus', windowMinutes: 15 }, now);
    expect(repository.outcomesSince).toHaveBeenCalledWith(ago(900));
    expect(result.ingestion.windowMinutes).toBe(15);
  });

  it('reports the subscriber down when the probe says so, unknown without a probe', async () => {
    const probe = new MqttConnectionState();
    expect((await service(probe).status({ op: 'syncStatus' }, now)).broker.subscriber).toBe('down');
    expect((await service(null).status({ op: 'syncStatus' }, now)).broker.subscriber).toBe(
      'unknown',
    );
    expect((await service().status({ op: 'syncStatus' })).broker.subscriber).toBe('unknown');
  });
});
