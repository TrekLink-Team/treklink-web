import { DeviceStatus } from '@prisma/client';
import { DeviceConnectorService } from './device-connector.service';

const VARIANT = {
  id: 'v-3',
  code: 'treklink-v3',
  name: 'TrekLink v3 (GPS, SOS button)',
  imageUrl: null,
  specSheet: {},
  hasGps: true,
  hasMotionSensor: false,
  mqttCapable: true,
  firmwareBaseline: '2.7.19-treklink.3',
  serviceIntervalDays: 180,
};

const row = (id: string, assetTag: string, nodeNum: bigint, extra: object = {}) => ({
  id,
  assetTag,
  nodeNum,
  firmwareVersion: '2.7.19-treklink.3',
  acquiredAt: new Date('2026-06-15T00:00:00Z'),
  status: DeviceStatus.RESERVED,
  statusChangedAt: new Date('2026-11-01T00:00:00Z'),
  keyVersion: null as number | null,
  keyOrganizationId: null as string | null,
  batteryPct: 96,
  lastSeenAt: null,
  lastLatitude: null,
  lastLongitude: null,
  serviceDueAt: null,
  version: 3,
  hardwareVariant: VARIANT,
  ...extra,
});

describe('DeviceConnectorService', () => {
  const at = new Date('2026-11-04T03:00:00Z');
  let devices: { byNodeNums: jest.Mock };
  let fleet: { fleetViews: jest.Mock };
  let maintenance: { openRecordOf: jest.Mock };
  let sessions: { open: jest.Mock };
  let parameters: { get: jest.Mock };
  let contracts: { liveContractsOf: jest.Mock };
  let directory: { namesOf: jest.Mock };
  let service: DeviceConnectorService;

  beforeEach(() => {
    devices = { byNodeNums: jest.fn() };
    fleet = {
      fleetViews: jest.fn((views: { id: string }[]) =>
        Promise.resolve(views.map((view) => ({ ...view, keyOrganization: null }))),
      ),
    };
    maintenance = { openRecordOf: jest.fn().mockResolvedValue(null) };
    sessions = { open: jest.fn().mockResolvedValue([]) };
    parameters = { get: jest.fn().mockResolvedValue(30) };
    contracts = { liveContractsOf: jest.fn().mockResolvedValue([]) };
    directory = { namesOf: jest.fn().mockResolvedValue(new Map([['u-1', 'Tran Thi B']])) };
    service = new DeviceConnectorService(
      devices as never,
      fleet as never,
      maintenance as never,
      sessions as never,
      parameters as never,
      contracts,
      directory,
    );
  });

  it('answers in request order, with null for a number never registered', async () => {
    devices.byNodeNums.mockResolvedValue([row('d-42', 'TL-0042', 2763113171n)]);

    const units = await service.recognize([0xa4b1c2e4n, 2763113171n], at);

    expect(units.map((unit) => unit.nodeId)).toEqual(['!a4b1c2e4', '!a4b1c2d3']);
    expect(units[0]).toEqual({
      nodeNum: 0xa4b1c2e4,
      nodeId: '!a4b1c2e4',
      device: null,
      contract: null,
      docked: null,
    });
    expect(units[1].device).toMatchObject({
      assetTag: 'TL-0042',
      status: 'RESERVED',
      firmwareBaseline: '2.7.19-treklink.3',
      openMaintenance: null,
    });
  });

  it('names the live contract and the key version only when the unit carries its organization key', async () => {
    devices.byNodeNums.mockResolvedValue([
      row('d-42', 'TL-0042', 1n, { keyVersion: 2, keyOrganizationId: 'org-7' }),
      row('d-43', 'TL-0043', 2n, { keyVersion: 1, keyOrganizationId: 'org-other' }),
    ]);
    contracts.liveContractsOf.mockResolvedValue([
      {
        deviceId: 'd-42',
        contractId: 'c-1',
        code: 'RC-2026-0042',
        status: 'APPROVED',
        organizationId: 'org-7',
        organizationCode: 'ORG-0007',
      },
      {
        deviceId: 'd-43',
        contractId: 'c-1',
        code: 'RC-2026-0042',
        status: 'APPROVED',
        organizationId: 'org-7',
        organizationCode: 'ORG-0007',
      },
    ]);

    const [first, second] = await service.recognize([1n, 2n], at);

    expect(first.contract).toEqual({
      id: 'c-1',
      code: 'RC-2026-0042',
      status: 'APPROVED',
      organization: { id: 'org-7', code: 'ORG-0007' },
      provisionedKeyVersion: 2,
    });
    expect(second.contract?.provisionedKeyVersion).toBeNull();
  });

  it('carries the open dock session with the name of who opened it', async () => {
    devices.byNodeNums.mockResolvedValue([row('d-42', 'TL-0042', 1n)]);
    const openedAt = new Date('2026-11-04T02:59:50Z');
    sessions.open.mockResolvedValue([
      {
        id: 's-1',
        deviceId: 'd-42',
        nodeNum: 1n,
        openedById: 'u-1',
        openedAt,
        renewedAt: openedAt,
        endedAt: null,
        endReason: null,
      },
    ]);

    const [unit] = await service.recognize([1n], at);

    expect(unit.docked).toEqual({ since: openedAt, byName: 'Tran Thi B' });
    expect(sessions.open).toHaveBeenCalledWith(new Date('2026-11-04T02:59:30Z'), ['d-42']);
  });

  it('reads no session when no unit is registered', async () => {
    devices.byNodeNums.mockResolvedValue([]);

    await service.recognize([1n], at);

    expect(sessions.open).not.toHaveBeenCalled();
    expect(contracts.liveContractsOf).not.toHaveBeenCalled();
  });
});
