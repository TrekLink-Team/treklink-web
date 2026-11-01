import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SyncStatsService } from '../gateway-sync';
import { IncidentsQueryService } from '../incidents';
import { FieldStationReleaseService, FieldStationsService } from '../organizations';
import { HealthService } from '../platform/health/health.service';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  HEALTH_WINDOW_MAX_MINUTES,
  SystemHealthQueryDto,
  SystemHealthService,
} from './system-health.service';

const now = new Date('2026-11-01T03:20:00.000Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

const station = (overrides: Record<string, unknown> = {}) => ({
  id: 'fs-1',
  name: 'Ta Nang basecamp laptop',
  mqttUsername: 'fs-org-0001-1',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'ACME Trek Co., Ltd.' },
  lastSyncAt: ago(30),
  lastFlushAt: ago(35),
  queueDepth: [0, 0, 14, 230],
  oldestRetryCount: 2,
  version: '1.2.0',
  ...overrides,
});

describe('SystemHealthService.report (monitoring api-design 06)', () => {
  let health: { check: jest.Mock };
  let sync: { stats: jest.Mock };
  let stations: { activeWithHealth: jest.Mock };
  let release: { currentOrNull: jest.Mock };
  let incidents: { alertDeliveryStats: jest.Mock };
  let parameters: { get: jest.Mock };

  const build = () =>
    new SystemHealthService(
      health as unknown as HealthService,
      sync as unknown as SyncStatsService,
      stations as unknown as FieldStationsService,
      release as unknown as FieldStationReleaseService,
      incidents as unknown as IncidentsQueryService,
      parameters as unknown as ParameterService,
    );

  beforeEach(() => {
    health = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        uptimeSeconds: 10,
        components: { database: 'up', mqtt: 'up' },
        version: '1.0.0',
      }),
    };
    sync = {
      stats: jest.fn().mockResolvedValue({
        windowMinutes: 60,
        accepted: 2471,
        duplicates: 12,
        malformed: 0,
        unknownDevice: 1,
        lastReceivedAt: ago(5),
        devicesBuffering: 2,
      }),
    };
    stations = { activeWithHealth: jest.fn().mockResolvedValue([station()]) };
    release = { currentOrNull: jest.fn().mockResolvedValue({ version: '1.2.0' }) };
    incidents = { alertDeliveryStats: jest.fn().mockResolvedValue({ pending: 0, failed: 1 }) };
    parameters = { get: jest.fn().mockResolvedValue(180) };
  });

  it('composes the platform health, the ingestion of the window, the buffering devices and the alerts', async () => {
    const view = await build().report({}, now);
    expect(view.health).toEqual({ status: 'ok', components: { database: 'up', mqtt: 'up' } });
    expect(view.ingestion).toEqual({
      perMinute: 41.2,
      accepted: 2471,
      duplicates: 12,
      malformed: 0,
      unknownDevice: 1,
    });
    expect(view.devicesBuffering).toBe(2);
    expect(view.alerts).toEqual({ pending: 0, failed: 1 });
    expect(sync.stats).toHaveBeenCalledWith(60, now);
  });

  it('passes the requested window to the stats and divides by it', async () => {
    sync.stats.mockResolvedValue({
      windowMinutes: 10,
      accepted: 25,
      duplicates: 0,
      malformed: 0,
      unknownDevice: 0,
      lastReceivedAt: null,
      devicesBuffering: 0,
    });
    const view = await build().report({ windowMinutes: 10 }, now);
    expect(sync.stats).toHaveBeenCalledWith(10, now);
    expect(view.ingestion.perMinute).toBe(2.5);
  });

  it('reports a degraded broker without failing the read', async () => {
    health.check.mockResolvedValue({
      status: 'degraded',
      uptimeSeconds: 10,
      components: { database: 'up', mqtt: 'down' },
      version: '1.0.0',
    });
    const view = await build().report({}, now);
    expect(view.health).toEqual({
      status: 'degraded',
      components: { database: 'up', mqtt: 'down' },
    });
  });

  it('lists every station with its depth per priority, org name, version and outdated flag', async () => {
    stations.activeWithHealth.mockResolvedValue([
      station(),
      station({ id: 'fs-2', name: 'Old laptop', version: '1.1.0', queueDepth: [1, 0, 0, 0] }),
    ]);
    const { fieldStations } = await build().report({}, now);
    expect(fieldStations.total).toBe(2);
    expect(fieldStations.currentRelease).toBe('1.2.0');
    expect(fieldStations.outdated).toBe(1);
    expect(fieldStations.items[0]).toEqual({
      id: 'fs-1',
      name: 'Ta Nang basecamp laptop',
      organization: { id: 'org-1', name: 'ACME Trek Co., Ltd.' },
      lastSyncAt: ago(30),
      stale: false,
      queueDepth: { p0: 0, p1: 0, p2: 14, p3: 230 },
      oldestRetryCount: 2,
      version: '1.2.0',
      outdated: false,
    });
    expect(fieldStations.items[1].outdated).toBe(true);
    expect(fieldStations.maxQueueDepth).toEqual({ p0: 1, p1: 0, p2: 14, p3: 230 });
  });

  it('counts a station stale past monitoring.fieldStationStaleSeconds or when it never reported', async () => {
    stations.activeWithHealth.mockResolvedValue([
      station({ lastSyncAt: ago(180) }),
      station({ id: 'fs-2', lastSyncAt: ago(181) }),
      station({ id: 'fs-3', lastSyncAt: null, version: null }),
    ]);
    const { fieldStations } = await build().report({}, now);
    expect(fieldStations.items.map((item) => item.stale)).toEqual([false, true, true]);
    expect(fieldStations.stale).toBe(2);
    expect(parameters.get).toHaveBeenCalledWith('monitoring.fieldStationStaleSeconds');
  });

  it('marks no station outdated when the release cannot be read', async () => {
    release.currentOrNull.mockResolvedValue(null);
    stations.activeWithHealth.mockResolvedValue([station({ version: '0.0.1' })]);
    const { fieldStations } = await build().report({}, now);
    expect(fieldStations.currentRelease).toBeNull();
    expect(fieldStations.outdated).toBe(0);
  });

  it('answers zero depths and no stations for a platform with none', async () => {
    stations.activeWithHealth.mockResolvedValue([]);
    const { fieldStations } = await build().report({}, now);
    expect(fieldStations).toMatchObject({
      total: 0,
      stale: 0,
      outdated: 0,
      maxQueueDepth: { p0: 0, p1: 0, p2: 0, p3: 0 },
      items: [],
    });
  });

  it('fails whole when the health check does, as a database that cannot be reached', async () => {
    health.check.mockRejectedValue(new Error('database unreachable'));
    await expect(build().report({}, now)).rejects.toThrow('database unreachable');
  });
});

describe('SystemHealthQueryDto', () => {
  const check = async (plain: Record<string, unknown>) =>
    validate(plainToInstance(SystemHealthQueryDto, plain));

  it('accepts no window and a whole number of minutes up to one day', async () => {
    expect(await check({})).toHaveLength(0);
    expect(await check({ windowMinutes: '60' })).toHaveLength(0);
    expect(await check({ windowMinutes: HEALTH_WINDOW_MAX_MINUTES })).toHaveLength(0);
  });

  it('refuses zero, a negative, a fraction, a word and more than a day', async () => {
    for (const windowMinutes of ['0', '-5', '1.5', 'abc', String(HEALTH_WINDOW_MAX_MINUTES + 1)]) {
      expect(await check({ windowMinutes })).not.toHaveLength(0);
    }
  });
});
