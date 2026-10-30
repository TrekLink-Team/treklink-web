import { EventKind } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { FieldEventQueryService } from './field-event-query.service';
import { SyncQueryRepository } from './sync-query.repository';

const row = (seq: bigint, deviceId: string) => ({
  seq,
  eventId: `e-${seq}`,
  deviceId,
  organizationId: 'org-1',
  attribution: 'ATTRIBUTED',
  ingress: 'MQTT_NODE',
  uplinkKey: '!de000009',
  kind: 'POSITION',
  priority: 'P2_GPS',
  observedAt: null,
  receivedAt: new Date('2026-11-01T03:15:00Z'),
  latitude: 11.56,
  longitude: 108.54,
  altitude: 1320,
  batteryPct: 81,
  rssi: null,
  snr: null,
  hopsAway: null,
  plotted: true,
  incidentId: null,
});

describe('FieldEventQueryService.listEvents (api-design 03)', () => {
  let repository: { pageEvents: jest.Mock };
  let devices: { assetTags: jest.Mock };
  let service: FieldEventQueryService;

  beforeEach(() => {
    repository = { pageEvents: jest.fn().mockResolvedValue([[row(7n, 'd-1'), row(8n, 'd-2')], 2]) };
    devices = { assetTags: jest.fn().mockResolvedValue(new Map([['d-1', 'TL-0009']])) };
    service = new FieldEventQueryService(
      repository as unknown as SyncQueryRepository,
      devices as unknown as DevicesService,
    );
  });

  it('pages the ledger by seq, oldest first, 100 a page by default, with asset tags', async () => {
    const result = await service.listEvents({ op: 'listEvents' });
    expect(repository.pageEvents).toHaveBeenCalledWith({}, 'asc', 0, 100);
    expect(devices.assetTags).toHaveBeenCalledWith(['d-1', 'd-2']);
    expect(result).toMatchObject({ pageNumber: 1, pageSize: 100, totalCount: 2, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ seq: 7, assetTag: 'TL-0009', eventId: 'e-7' });
    expect(result.items[1].assetTag).toBeNull();
  });

  it('applies every filter, the order and the page', async () => {
    const from = new Date('2026-11-01T00:00:00Z');
    const to = new Date('2026-11-01T06:00:00Z');
    await service.listEvents({
      op: 'listEvents',
      deviceId: 'd-1',
      organizationId: 'org-1',
      kind: [EventKind.SOS, EventKind.POSITION],
      incidentId: 'inc-1',
      from,
      to,
      order: 'desc',
      pageNumber: 2,
      pageSize: 20,
    });
    expect(repository.pageEvents).toHaveBeenCalledWith(
      {
        deviceId: 'd-1',
        organizationId: 'org-1',
        kind: { in: ['SOS', 'POSITION'] },
        incidentId: 'inc-1',
        receivedAt: { gte: from, lte: to },
      },
      'desc',
      20,
      20,
    );
  });

  it('bounds the period on one side only when one bound is given', async () => {
    const to = new Date('2026-11-01T06:00:00Z');
    await service.listEvents({ op: 'listEvents', to, kind: [] });
    const [where] = repository.pageEvents.mock.calls[0] as [unknown];
    expect(where).toEqual({ receivedAt: { lte: to } });
  });

  it('refuses a page larger than 500 with 400 VALIDATION_FAILED', async () => {
    await expect(service.listEvents({ op: 'listEvents', pageSize: 501 })).rejects.toMatchObject({
      errorCode: ErrorCode.VALIDATION_FAILED,
    });
  });
});
