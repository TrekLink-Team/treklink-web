import { createMongoAbility } from '@casl/ability';
import { Caller, PolicyAbility } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { FieldEventQueryService } from '../gateway-sync';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsService } from '../rentals';
import { HistoryService } from './history.service';

const DEVICE = 'd-1';
const FROM = new Date('2026-10-20T00:00:00.000Z');
const TO = new Date('2026-10-21T00:00:00.000Z');

const staff = createMongoAbility([
  { action: 'read', subject: 'TelemetryHistory' },
]) as unknown as PolicyAbility;
const member = createMongoAbility([
  { action: 'read', subject: 'TelemetryHistory', conditions: { organizationId: 'org-1' } },
]) as unknown as PolicyAbility;
const nobody = createMongoAbility([]) as unknown as PolicyAbility;

const staffCaller: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const memberCaller: Caller = { id: 'u-op', roles: ['ORG_OPERATOR'], organizationId: 'org-1' };

const point = (at: string, overrides: Record<string, unknown> = {}) => ({
  at: new Date(at),
  kind: 'POSITION' as const,
  lat: 11.56,
  lon: 108.54,
  altitude: 1320,
  batteryPct: 81,
  ...overrides,
});

describe('HistoryService (monitoring 3.3, api-design 03)', () => {
  let contracts: { rentalPeriods: jest.Mock };
  let devices: { assetTags: jest.Mock };
  let events: { historyPoints: jest.Mock };
  let parameters: { get: jest.Mock };
  let service: HistoryService;

  beforeEach(() => {
    contracts = {
      rentalPeriods: jest
        .fn()
        .mockResolvedValue([
          { from: new Date('2026-10-20T02:00:00.000Z'), to: new Date('2026-10-21T06:00:00.000Z') },
        ]),
    };
    devices = { assetTags: jest.fn().mockResolvedValue(new Map([[DEVICE, 'TL-0042']])) };
    events = {
      historyPoints: jest
        .fn()
        .mockResolvedValue({ points: [point('2026-10-20T03:15:00.000Z')], truncated: false }),
    };
    parameters = { get: jest.fn().mockResolvedValue(7) };
    service = new HistoryService(
      contracts as unknown as ContractsService,
      devices as unknown as DevicesService,
      events as unknown as FieldEventQueryService,
      parameters as unknown as ParameterService,
    );
  });

  describe('an organization member', () => {
    it("reads only its organization's events, with the periods it held the device", async () => {
      await expect(
        service.history(DEVICE, { from: FROM, to: TO }, memberCaller, member),
      ).resolves.toEqual({
        deviceId: DEVICE,
        clippedTo: [{ from: '2026-10-20T02:00:00.000Z', to: '2026-10-21T06:00:00.000Z' }],
        points: [
          {
            at: '2026-10-20T03:15:00.000Z',
            kind: 'POSITION',
            lat: 11.56,
            lon: 108.54,
            altitude: 1320,
            batteryPct: 81,
          },
        ],
        truncated: false,
      });
      expect(contracts.rentalPeriods).toHaveBeenCalledWith(DEVICE, 'org-1');
      expect(events.historyPoints).toHaveBeenCalledWith({
        deviceId: DEVICE,
        organizationId: 'org-1',
        from: FROM,
        to: TO,
        kinds: ['POSITION', 'TELEMETRY'],
      });
    });

    it('gets 404 and nothing is read when the organization never held the device', async () => {
      contracts.rentalPeriods.mockResolvedValue([]);
      await expect(
        service.history(DEVICE, { from: FROM, to: TO }, memberCaller, member),
      ).rejects.toMatchObject({ status: 404, response: { errorCode: ErrorCode.NOT_FOUND } });
      expect(events.historyPoints).not.toHaveBeenCalled();
    });

    it('lists whole periods that overlap the range and leaves out the others', async () => {
      contracts.rentalPeriods.mockResolvedValue([
        { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-10T00:00:00.000Z') },
        { from: new Date('2026-10-19T00:00:00.000Z'), to: null },
      ]);
      const result = await service.history(DEVICE, { from: FROM, to: TO }, memberCaller, member);
      expect(result.clippedTo).toEqual([{ from: '2026-10-19T00:00:00.000Z', to: null }]);
    });

    it('answers 200 with no points and the period when the range misses the rental', async () => {
      contracts.rentalPeriods.mockResolvedValue([
        { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-10T00:00:00.000Z') },
      ]);
      events.historyPoints.mockResolvedValue({ points: [], truncated: false });
      const result = await service.history(DEVICE, { from: FROM, to: TO }, memberCaller, member);
      expect(result).toEqual({ deviceId: DEVICE, clippedTo: [], points: [], truncated: false });
    });

    it('is refused when the caller has no organization', async () => {
      await expect(
        service.history(
          DEVICE,
          { from: FROM, to: TO },
          { ...memberCaller, organizationId: null },
          member,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('TrekLink Staff', () => {
    it('reads the whole history, not clipped, and needs only that the device exists', async () => {
      const result = await service.history(DEVICE, { from: FROM, to: TO }, staffCaller, staff);
      expect(result.clippedTo).toEqual([]);
      expect(contracts.rentalPeriods).not.toHaveBeenCalled();
      expect(events.historyPoints).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: DEVICE, organizationId: null }),
      );
    });

    it('gets 404 for an unknown device', async () => {
      devices.assetTags.mockResolvedValue(new Map());
      await expect(
        service.history(DEVICE, { from: FROM, to: TO }, staffCaller, staff),
      ).rejects.toMatchObject({ status: 404 });
      expect(events.historyPoints).not.toHaveBeenCalled();
    });
  });

  it('refuses a caller whose role holds no history permission', async () => {
    await expect(
      service.history(DEVICE, { from: FROM, to: TO }, memberCaller, nobody),
    ).rejects.toMatchObject({ status: 403, response: { errorCode: ErrorCode.FORBIDDEN } });
  });

  describe('the range (REQ-ERR-02)', () => {
    const attempt = (from: Date, to: Date) =>
      service.history(DEVICE, { from, to }, staffCaller, staff);

    it('refuses a reversed or empty range', async () => {
      await expect(attempt(TO, FROM)).rejects.toMatchObject({
        status: 400,
        response: { errorCode: ErrorCode.VALIDATION_FAILED },
      });
      await expect(attempt(FROM, FROM)).rejects.toMatchObject({ status: 400 });
    });

    it('refuses more than the configured days and says how many', async () => {
      await expect(attempt(FROM, new Date('2026-10-27T00:00:00.001Z'))).rejects.toMatchObject({
        status: 400,
        message: 'to must be after from and at most 7 days later.',
      });
    });

    it('accepts exactly the configured days', async () => {
      await expect(attempt(FROM, new Date('2026-10-27T00:00:00.000Z'))).resolves.toBeDefined();
    });

    it('follows the parameter', async () => {
      parameters.get.mockResolvedValue(1);
      await expect(attempt(FROM, new Date('2026-10-21T00:00:01.000Z'))).rejects.toMatchObject({
        status: 400,
        message: 'to must be after from and at most 1 days later.',
      });
    });

    it('answers a bad range before it looks the device up', async () => {
      devices.assetTags.mockResolvedValue(new Map());
      await expect(attempt(TO, FROM)).rejects.toMatchObject({ status: 400 });
      expect(devices.assetTags).not.toHaveBeenCalled();
    });

    it('fails clearly when the parameter is not a number', async () => {
      parameters.get.mockResolvedValue('seven');
      await expect(attempt(FROM, TO)).rejects.toMatchObject({ status: 500 });
    });
  });

  it('passes the truncated flag through when the range holds more points than the cap', async () => {
    events.historyPoints.mockResolvedValue({
      points: [point('2026-10-20T03:15:00.000Z')],
      truncated: true,
    });
    const result = await service.history(DEVICE, { from: FROM, to: TO }, staffCaller, staff);
    expect(result.truncated).toBe(true);
    expect(result.points).toHaveLength(1);
  });

  it('passes the kinds the caller asked for', async () => {
    await service.history(DEVICE, { from: FROM, to: TO, kind: ['TELEMETRY'] }, staffCaller, staff);
    expect(events.historyPoints).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ['TELEMETRY'] }),
    );
  });

  describe('csv', () => {
    it('writes a header and one row per point, empty for a value not sent', () => {
      const csv = service.csv({
        deviceId: DEVICE,
        clippedTo: [],
        truncated: false,
        points: [
          {
            at: '2026-10-20T03:15:00.000Z',
            kind: 'POSITION',
            lat: 11.56,
            lon: 108.54,
            altitude: null,
            batteryPct: 81,
          },
          {
            at: '2026-10-20T03:16:00.000Z',
            kind: 'TELEMETRY',
            lat: null,
            lon: null,
            altitude: null,
            batteryPct: 80,
          },
        ],
      });
      expect(csv).toBe(
        [
          'at,kind,lat,lon,altitude,batteryPct',
          '2026-10-20T03:15:00.000Z,POSITION,11.56,108.54,,81',
          '2026-10-20T03:16:00.000Z,TELEMETRY,,,,80',
        ].join('\n'),
      );
    });

    it('is only the header for no points', () => {
      expect(service.csv({ deviceId: DEVICE, clippedTo: [], points: [], truncated: false })).toBe(
        'at,kind,lat,lon,altitude,batteryPct',
      );
    });
  });
});
