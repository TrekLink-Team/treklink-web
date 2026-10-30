import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { IncidentsQueryService } from '../incidents';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsService } from '../rentals';
import { OrgApiService } from './org-api.service';
import { ReplayService } from './replay.service';
import { StreamRepository } from './stream.repository';

const NOW = new Date('2026-10-30T03:00:00.000Z');
const FRESH = new Date('2026-10-30T02:58:00.000Z');
const OLD = new Date('2026-10-30T02:00:00.000Z');

const projection = (id: string, assetTag: string, overrides: Record<string, unknown> = {}) => ({
  id,
  assetTag,
  nodeNum: 1n,
  status: 'RENTED',
  variantCode: 'treklink-v3',
  lastSeenAt: FRESH,
  batteryPct: 81,
  lastLatitude: 11.56,
  lastLongitude: 108.54,
  ...overrides,
});

const wire = (seq: number) => ({
  seq,
  type: 'device.position',
  deviceId: 'd-1',
  payload: {},
  createdAt: '2026-10-30T02:00:00.000Z',
});

describe('OrgApiService (monitoring 3.2, api-design 04 and 05)', () => {
  let contracts: { visibleDevices: jest.Mock };
  let devices: { projections: jest.Mock };
  let incidents: { openByDevices: jest.Mock };
  let replays: { isExpired: jest.Mock; batchAfter: jest.Mock };
  let stream: { maxSeq: jest.Mock };
  let service: OrgApiService;

  beforeEach(() => {
    contracts = {
      visibleDevices: jest.fn().mockResolvedValue([
        {
          deviceId: 'd-1',
          contractId: 'c-1',
          contractCode: 'RC-2026-0001',
          organizationId: 'org-1',
          holder: { name: 'Le Thi E' },
        },
        {
          deviceId: 'd-2',
          contractId: 'c-1',
          contractCode: 'RC-2026-0001',
          organizationId: 'org-1',
          holder: null,
        },
        {
          deviceId: 'd-3',
          contractId: 'c-1',
          contractCode: 'RC-2026-0001',
          organizationId: 'org-1',
          holder: null,
        },
      ]),
    };
    devices = {
      projections: jest.fn().mockResolvedValue([
        projection('d-1', 'TL-0008'),
        projection('d-2', 'TL-0009', { lastSeenAt: OLD, lastLatitude: null }),
        projection('d-3', 'TL-0010', {
          lastSeenAt: null,
          lastLatitude: null,
          lastLongitude: null,
        }),
      ]),
    };
    incidents = {
      openByDevices: jest.fn().mockResolvedValue(
        new Map([
          [
            'd-1',
            {
              id: 'i-1',
              code: 'INC-2026-000001',
              state: 'NOTIFY_PRIMARY',
              organizationId: 'org-1',
            },
          ],
          [
            'd-2',
            { id: 'i-2', code: 'INC-2026-000002', state: 'ACKNOWLEDGED', organizationId: 'org-9' },
          ],
        ]),
      ),
    };
    replays = {
      isExpired: jest.fn().mockResolvedValue(false),
      batchAfter: jest.fn().mockResolvedValue([wire(11), wire(12)]),
    };
    stream = { maxSeq: jest.fn().mockResolvedValue(88213) };
    const parameters = { get: jest.fn().mockResolvedValue(300) };
    service = new OrgApiService(
      contracts as unknown as ContractsService,
      devices as unknown as DevicesService,
      incidents as unknown as IncidentsQueryService,
      replays as unknown as ReplayService,
      stream as unknown as StreamRepository,
      parameters as unknown as ParameterService,
    );
  });

  describe('devicesOf', () => {
    it('lists the devices the key organization holds, with the cursor and last state', async () => {
      const result = await service.devicesOf('org-1', NOW);

      expect(contracts.visibleDevices).toHaveBeenCalledWith({ organizationId: 'org-1' });
      expect(devices.projections).toHaveBeenCalledWith(['d-1', 'd-2', 'd-3']);
      expect(result.cursor).toBe(88213);
      expect(result.devices[0]).toEqual({
        id: 'd-1',
        assetTag: 'TL-0008',
        hardwareVariant: 'treklink-v3',
        holder: { name: 'Le Thi E' },
        position: { lat: 11.56, lon: 108.54, at: FRESH },
        batteryPct: 81,
        lastSeenAt: FRESH,
        stale: false,
        openIncident: { id: 'i-1', code: 'INC-2026-000001', state: 'NOTIFY_PRIMARY' },
        contractCode: 'RC-2026-0001',
      });
    });

    it('marks silent devices stale, omits a missing fix and hides another organization incident', async () => {
      const [, old, never] = (await service.devicesOf('org-1', NOW)).devices;
      expect(old).toMatchObject({ stale: true, position: null, openIncident: null });
      expect(never).toMatchObject({ stale: true, position: null, lastSeenAt: null });
    });

    it('uses the clock when no time is given', async () => {
      await expect(service.devicesOf('org-1')).resolves.toMatchObject({ cursor: 88213 });
    });
  });

  describe('streamOf', () => {
    it('returns the entries after the cursor and the next cursor', async () => {
      await expect(service.streamOf('org-1', 10, 200)).resolves.toEqual({
        entries: [wire(11), wire(12)],
        nextCursor: 12,
        hasMore: false,
      });
      expect(replays.batchAfter).toHaveBeenCalledWith('org-1', 10, 201);
    });

    it('says there is more when the page is full', async () => {
      const page = await service.streamOf('org-1', 10, 1);
      expect(page).toEqual({ entries: [wire(11)], nextCursor: 11, hasMore: true });
    });

    it('keeps the cursor when nothing is new', async () => {
      replays.batchAfter.mockResolvedValue([]);
      await expect(service.streamOf('org-1', 10, 200)).resolves.toEqual({
        entries: [],
        nextCursor: 10,
        hasMore: false,
      });
    });

    it('answers 410 CURSOR_EXPIRED for a cursor outside the retention window', async () => {
      replays.isExpired.mockResolvedValue(true);
      await expect(service.streamOf('org-1', 1, 200)).rejects.toMatchObject({
        errorCode: ErrorCode.CURSOR_EXPIRED,
        httpStatus: 410,
      });
      expect(replays.batchAfter).not.toHaveBeenCalled();
    });
  });
});
