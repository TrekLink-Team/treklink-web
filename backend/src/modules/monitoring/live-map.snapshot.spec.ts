import { Logger } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';
import type { PolicyAbility } from '../../common/decorators/access.decorator';
import type { DevicesService } from '../devices';
import type { IncidentsQueryService } from '../incidents';
import type { OrganizationsService } from '../organizations';
import type { ParameterService } from '../platform/parameters/parameter.service';
import type { ContractsService } from '../rentals';
import { LiveMapService } from './live-map.service';
import type { StreamRepository } from './stream.repository';

const NOW = new Date('2026-10-30T03:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);
const HANDED_OVER = ago(3600);
const COUNTER = { name: 'TrekLink counter', lat: 11.9, lon: 108.4 };

const VISIBLE = [
  {
    deviceId: 'd-1',
    contractId: 'c-1',
    contractCode: 'RC-2026-0001',
    organizationId: 'org-1',
    handedOverAt: HANDED_OVER,
    holder: { name: 'Le Thi E' },
  },
  {
    deviceId: 'd-2',
    contractId: 'c-1',
    contractCode: 'RC-2026-0001',
    organizationId: 'org-1',
    handedOverAt: HANDED_OVER,
    holder: null,
  },
  {
    deviceId: 'd-3',
    contractId: 'c-1',
    contractCode: 'RC-2026-0001',
    organizationId: 'org-1',
    handedOverAt: HANDED_OVER,
    holder: null,
  },
];

const PROJECTIONS = [
  {
    id: 'd-1',
    assetTag: 'TL-0001',
    nodeNum: 1n,
    status: 'RENTED',
    variantCode: 'treklink-v3',
    lastSeenAt: ago(30),
    lastBatteryAt: ago(30),
    batteryPct: 81,
    lastLatitude: 11.56,
    lastLongitude: 108.54,
    lastPositionAt: ago(30),
  },
  {
    id: 'd-2',
    assetTag: 'TL-0002',
    nodeNum: 2n,
    status: 'RENTED',
    variantCode: 'treklink-v3',
    lastSeenAt: ago(600),
    lastBatteryAt: ago(600),
    batteryPct: 40,
    lastLatitude: null,
    lastLongitude: null,
    lastPositionAt: null,
  },
  {
    id: 'd-3',
    assetTag: 'TL-0003',
    nodeNum: 3n,
    status: 'RENTED',
    variantCode: 'treklink-v3',
    lastSeenAt: null,
    lastBatteryAt: null,
    batteryPct: null,
    lastLatitude: null,
    lastLongitude: null,
    lastPositionAt: null,
  },
  // A projection the rentals read did not list is never shown.
  {
    id: 'd-9',
    assetTag: 'TL-0009',
    nodeNum: 9n,
    status: 'AVAILABLE',
    variantCode: 'treklink-v3',
    lastSeenAt: ago(1),
    lastBatteryAt: ago(1),
    batteryPct: 90,
    lastLatitude: 1,
    lastLongitude: 1,
    lastPositionAt: ago(1),
  },
];

// An ability like the CASL one: the unconditioned rule matches any organization, the own rule only
// the given one.
const staff: PolicyAbility = { can: () => true };
const member = (organizationId: string): PolicyAbility => ({
  can: (_action, target) =>
    typeof target === 'object' &&
    (target as { organizationId?: string }).organizationId === organizationId,
});
const nobody: PolicyAbility = { can: () => false };

// The organization's Field Stations: one fresh, one silent past the threshold, one never synced (MF-02).
const STATIONS = [
  { id: 'fs-1', organizationId: 'org-1', name: 'Ta Nang basecamp laptop', lastSyncAt: ago(60) },
  { id: 'fs-2', organizationId: 'org-1', name: 'Phan Dung ranger post', lastSyncAt: ago(600) },
  { id: 'fs-3', organizationId: 'org-1', name: 'Spare laptop', lastSyncAt: null },
];

const callerOf = (organizationId: string | null) => ({ id: 'u-1', roles: [], organizationId });

describe('LiveMapService.snapshot', () => {
  let visibleDevices: jest.Mock;
  let projections: jest.Mock;
  let openByDevices: jest.Mock;
  let maxSeq: jest.Mock;
  let fieldStationHealth: jest.Mock;
  let stale: unknown;
  let stationStale: unknown;
  let counter: unknown;
  let service: LiveMapService;

  beforeEach(() => {
    stale = 300;
    stationStale = 180;
    counter = COUNTER;
    fieldStationHealth = jest.fn().mockResolvedValue(STATIONS);
    visibleDevices = jest.fn().mockResolvedValue(VISIBLE);
    projections = jest.fn().mockResolvedValue(PROJECTIONS);
    openByDevices = jest.fn().mockResolvedValue(
      new Map([
        [
          'd-1',
          { id: 'i-1', code: 'INC-2026-000001', state: 'NOTIFY_PRIMARY', organizationId: 'org-1' },
        ],
        [
          'd-2',
          { id: 'i-2', code: 'INC-2026-000002', state: 'ACKNOWLEDGED', organizationId: 'org-2' },
        ],
      ]),
    );
    maxSeq = jest.fn().mockResolvedValue(42);
    service = new LiveMapService(
      {
        get: jest.fn((key: string) =>
          Promise.resolve(
            key === 'monitoring.fieldStationStaleSeconds'
              ? stationStale
              : key === 'monitoring.counterLocation'
                ? counter
                : stale,
          ),
        ),
      } as unknown as ParameterService,
      { visibleDevices } as unknown as ContractsService,
      { projections } as unknown as DevicesService,
      { openByDevices } as unknown as IncidentsQueryService,
      { maxSeq } as unknown as StreamRepository,
      { fieldStationHealth } as unknown as OrganizationsService,
    );
  });

  it('composes the visible devices with their projection, open incident and staleness', async () => {
    const result = await service.snapshot({}, callerOf('org-1'), member('org-1'), NOW);
    expect(result).toEqual({
      cursor: 42,
      fieldStations: [
        {
          id: 'fs-1',
          name: 'Ta Nang basecamp laptop',
          lastSyncAt: ago(60).toISOString(),
          stale: false,
        },
        {
          id: 'fs-2',
          name: 'Phan Dung ranger post',
          lastSyncAt: ago(600).toISOString(),
          stale: true,
        },
        { id: 'fs-3', name: 'Spare laptop', lastSyncAt: null, stale: false },
      ],
      devices: [
        {
          id: 'd-1',
          assetTag: 'TL-0001',
          hardwareVariant: 'treklink-v3',
          holder: { name: 'Le Thi E' },
          position: { lat: 11.56, lon: 108.54, at: ago(30).toISOString() },
          batteryPct: 81,
          lastSeenAt: ago(30).toISOString(),
          stale: false,
          state: 'LIVE',
          handedOverAt: HANDED_OVER.toISOString(),
          counterLocation: null,
          openIncident: { id: 'i-1', code: 'INC-2026-000001', state: 'NOTIFY_PRIMARY' },
          contractCode: 'RC-2026-0001',
          organizationId: 'org-1',
        },
        {
          id: 'd-2',
          assetTag: 'TL-0002',
          hardwareVariant: 'treklink-v3',
          holder: null,
          position: null,
          batteryPct: 40,
          lastSeenAt: ago(600).toISOString(),
          stale: true,
          state: 'OFFLINE',
          handedOverAt: HANDED_OVER.toISOString(),
          counterLocation: null,
          openIncident: null,
          contractCode: 'RC-2026-0001',
          organizationId: 'org-1',
        },
        {
          id: 'd-3',
          assetTag: 'TL-0003',
          hardwareVariant: 'treklink-v3',
          holder: null,
          position: null,
          batteryPct: null,
          lastSeenAt: null,
          stale: false,
          state: 'NOT_HEARD',
          handedOverAt: HANDED_OVER.toISOString(),
          counterLocation: COUNTER,
          openIncident: null,
          contractCode: 'RC-2026-0001',
          organizationId: 'org-1',
        },
      ],
    });
    expect(visibleDevices).toHaveBeenCalledWith({ organizationId: 'org-1' });
    expect(projections).toHaveBeenCalledWith(['d-1', 'd-2', 'd-3']);
    expect(openByDevices).toHaveBeenCalledWith(['d-1', 'd-2', 'd-3']);
    expect(fieldStationHealth).toHaveBeenCalledWith('org-1');
  });

  it('reads the cursor before the devices, so nothing committed meanwhile is lost', async () => {
    const order: string[] = [];
    maxSeq.mockImplementation(() => {
      order.push('cursor');
      return Promise.resolve(1);
    });
    visibleDevices.mockImplementation(() => {
      order.push('devices');
      return Promise.resolve([]);
    });
    await service.snapshot({}, callerOf(null), staff, NOW);
    expect(order).toEqual(['cursor', 'devices']);
  });

  it('gives TrekLink staff the fleet, or the one organization they ask for', async () => {
    await service.snapshot({}, callerOf(null), staff);
    expect(visibleDevices).toHaveBeenLastCalledWith({ organizationId: null });
    expect(fieldStationHealth).toHaveBeenLastCalledWith(null);
    const fleet = await service.snapshot({}, callerOf(null), staff, NOW);
    // The fleet sees the incident routed to another organization than the device's custodian.
    expect(fleet.devices[1].openIncident).toEqual({
      id: 'i-2',
      code: 'INC-2026-000002',
      state: 'ACKNOWLEDGED',
    });
    const one = await service.snapshot({ organizationId: 'org-2' }, callerOf(null), staff, NOW);
    expect(visibleDevices).toHaveBeenLastCalledWith({ organizationId: 'org-2' });
    expect(one.devices[0].openIncident).toBeNull();
    expect(one.devices[1].openIncident).toMatchObject({ id: 'i-2' });
  });

  it('refuses a member another organization, and an account with no map right', async () => {
    const refused = (promise: Promise<unknown>) =>
      expect(promise).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
    await refused(
      service.snapshot({ organizationId: 'org-2' }, callerOf('org-1'), member('org-1'), NOW),
    );
    await refused(service.snapshot({}, callerOf(null), member('org-1'), NOW));
    await refused(service.snapshot({}, callerOf('org-1'), nobody, NOW));
    await expect(
      service.snapshot({ organizationId: 'org-1' }, callerOf('org-1'), member('org-1'), NOW),
    ).resolves.toMatchObject({ cursor: 42 });
    expect(visibleDevices).toHaveBeenCalledTimes(1);
  });

  it('fails when the stale threshold is malformed', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    stale = 'soon';
    await expect(service.snapshot({}, callerOf(null), staff, NOW)).rejects.toThrow(
      'Map parameter monitoring.deviceStaleSeconds is malformed.',
    );
    await expect(service.snapshot({}, callerOf(null), staff, NOW)).rejects.not.toBeInstanceOf(
      DomainException,
    );
  });

  it('fails when the Field Station stale threshold is malformed', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    stationStale = null;
    await expect(service.snapshot({}, callerOf(null), staff, NOW)).rejects.toThrow(
      'Map parameter monitoring.fieldStationStaleSeconds is malformed.',
    );
  });

  // D-092 rule 2: a unit heard only before its handover is not heard since handover; an organization
  // gets nothing from before its custody interval (D-040), TrekLink staff keep the stored values.
  describe('custody interval (REQ-UBI-04)', () => {
    const beforeHandover = ago(7200);
    beforeEach(() => {
      projections.mockResolvedValue([
        // Heard and fixed before the handover only.
        {
          ...PROJECTIONS[0],
          lastSeenAt: beforeHandover,
          lastPositionAt: beforeHandover,
          batteryPct: 95,
        },
        // Heard since the handover by telemetry only: the stored fix is the previous custody's.
        {
          ...PROJECTIONS[1],
          lastLatitude: 12.1,
          lastLongitude: 108.9,
          lastPositionAt: beforeHandover,
        },
        // A fix stored before lastPositionAt existed: its time is unknown.
        { ...PROJECTIONS[2], lastSeenAt: ago(10), lastLatitude: 12.2, lastLongitude: 108.8 },
      ]);
    });

    it('shows an organization no position, reading time or battery from before the handover', async () => {
      const { devices } = await service.snapshot({}, callerOf('org-1'), member('org-1'), NOW);
      expect(devices.map((d) => [d.id, d.state, d.position, d.lastSeenAt])).toEqual([
        ['d-1', 'NOT_HEARD', null, null],
        ['d-2', 'OFFLINE', null, ago(600).toISOString()],
        ['d-3', 'LIVE', null, ago(10).toISOString()],
      ]);
      expect(devices[0]).toMatchObject({
        batteryPct: null,
        stale: false,
        counterLocation: COUNTER,
      });
      expect(devices[1].counterLocation).toBeNull();
    });

    it('keeps the stored values for TrekLink staff, with the same states', async () => {
      const { devices } = await service.snapshot(
        { organizationId: 'org-1' },
        callerOf(null),
        staff,
        NOW,
      );
      expect(devices.map((d) => [d.id, d.state, d.position, d.lastSeenAt])).toEqual([
        [
          'd-1',
          'NOT_HEARD',
          { lat: 11.56, lon: 108.54, at: beforeHandover.toISOString() },
          beforeHandover.toISOString(),
        ],
        [
          'd-2',
          'OFFLINE',
          { lat: 12.1, lon: 108.9, at: beforeHandover.toISOString() },
          ago(600).toISOString(),
        ],
        [
          'd-3',
          'LIVE',
          { lat: 12.2, lon: 108.8, at: ago(10).toISOString() },
          ago(10).toISOString(),
        ],
      ]);
      expect(devices[0]).toMatchObject({ batteryPct: 95, counterLocation: COUNTER });
    });

    it('counts a reading at the handover instant as heard since the handover', async () => {
      projections.mockResolvedValue([
        { ...PROJECTIONS[0], lastSeenAt: HANDED_OVER, lastPositionAt: HANDED_OVER },
      ]);
      const { devices } = await service.snapshot({}, callerOf('org-1'), member('org-1'), NOW);
      expect(devices[0]).toMatchObject({
        state: 'OFFLINE',
        position: { lat: 11.56, lon: 108.54, at: HANDED_OVER.toISOString() },
      });
    });
  });

  it('fails when the counter location is malformed', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    for (const bad of [
      null,
      [],
      { name: '', lat: 1, lon: 1 },
      { name: 'Counter', lat: '11', lon: 1 },
    ]) {
      counter = bad;
      await expect(service.snapshot({}, callerOf(null), staff, NOW)).rejects.toThrow(
        'Map parameter monitoring.counterLocation is malformed.',
      );
    }
  });
});
