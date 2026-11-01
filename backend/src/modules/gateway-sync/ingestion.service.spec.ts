import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DevicesService } from '../devices';
import { IncidentIngress, type PositionEvent, type SosEvent } from '../incidents';
import { ContractsService } from '../rentals';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { FieldStationsService } from '../organizations';
import { FieldStationJsonAdapter } from './adapters/field-station-json.adapter';
import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { CanonicalEnvelope } from './canonical-envelope';
import { IngestionRepository } from './ingestion.repository';
import { eventIdOf, IngestionService } from './ingestion.service';
import { Normalizer } from './normalizer/normalizer';
import { fixture } from './testing/fixtures';

const PARAMETERS: Record<string, unknown> = {
  'monitoring.positionBounds': { minLat: 8.0, maxLat: 23.5, minLon: 102.0, maxLon: 110.0 },
  'monitoring.maxPlausibleSpeedKmh': 30,
  'gatewaySync.deviceTimeMaxAheadSeconds': 60,
  'gatewaySync.lateUploadGraceHours': 168,
  'gatewaySync.attributionMarginSeconds': 300,
};
const device = { id: 'dev-9', assetTag: 'TL-0009', nodeNum: 0xde000009n, status: 'RENTED' };
const receivedAt = new Date('2026-10-23T03:00:05Z');
const adapter = new NodeJsonAdapter({
  get: () => 'treklink',
} as unknown as ConfigService<ValidatedEnvironment, true>);

const stationAdapter = new FieldStationJsonAdapter({
  get: () => 'treklink',
} as unknown as ConfigService<ValidatedEnvironment, true>);
// The E02-7 fixture flushed at 2026-10-24 02:00 UTC: corrected capture 2026-10-23 03:00 UTC.
const stationReceivedAt = new Date('2026-10-24T02:00:00Z');
const stationEnvelope = (): CanonicalEnvelope => {
  const [{ topic, body }] = fixture('station-sos-e02-7');
  const result = stationAdapter.adapt(topic, body, stationReceivedAt);
  if (result.kind !== 'envelope') throw new Error('station-sos-e02-7 is not an envelope fixture');
  return result.envelope;
};

const envelopeOf = (name: string, index = 0): CanonicalEnvelope => {
  const { topic, body } = fixture(name)[index];
  const result = adapter.adapt(topic, body, receivedAt);
  if (result.kind !== 'envelope') throw new Error(`${name} is not an envelope fixture`);
  return result.envelope;
};

describe('IngestionService', () => {
  const tx = { tx: true } as unknown as Prisma.TransactionClient;
  type Row = Record<string, unknown>;
  let repository: {
    insertEventOnce: jest.Mock<Promise<boolean>, [Row, unknown?]>;
    insertAudit: jest.Mock<Promise<void>, [Row, unknown?]>;
    lastPlottedPosition: jest.Mock;
    linkIncident: jest.Mock;
  };
  let devices: { byNodeNum: jest.Mock; projectReading: jest.Mock };
  let contracts: { custodyAt: jest.Mock; rentalPeriods: jest.Mock };
  let stations: { byUsername: jest.Mock };
  let incidents: {
    onSos: jest.Mock<Promise<{ id: string }>, [SosEvent, unknown]>;
    onPosition: jest.Mock<Promise<{ id: string } | null>, [PositionEvent, unknown]>;
  };
  let emitted: { name: string; payload: unknown }[];
  let service: IngestionService;

  beforeEach(() => {
    repository = {
      insertEventOnce: jest.fn<Promise<boolean>, [Row, unknown?]>().mockResolvedValue(true),
      insertAudit: jest.fn<Promise<void>, [Row, unknown?]>().mockResolvedValue(undefined),
      lastPlottedPosition: jest.fn().mockResolvedValue(null),
      linkIncident: jest.fn().mockResolvedValue(undefined),
    };
    devices = {
      byNodeNum: jest.fn().mockResolvedValue(device),
      projectReading: jest.fn().mockResolvedValue(device.id),
    };
    contracts = {
      custodyAt: jest.fn().mockResolvedValue(null),
      rentalPeriods: jest.fn().mockResolvedValue([]),
    };
    stations = { byUsername: jest.fn().mockResolvedValue(null) };
    emitted = [];
    const events = {
      transaction: async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
        const pending: { name: string; payload: unknown }[] = [];
        events.pending = pending;
        const result = await work(tx);
        emitted.push(...pending);
        return result;
      },
      pending: [] as { name: string; payload: unknown }[],
      emitAfterCommit: (name: string, payload: unknown) => events.pending.push({ name, payload }),
    };
    const parameters = { get: (key: string) => Promise.resolve(PARAMETERS[key]) };
    incidents = {
      onSos: jest
        .fn<Promise<{ id: string }>, [SosEvent, unknown]>()
        .mockResolvedValue({ id: 'incident-1' }),
      onPosition: jest
        .fn<Promise<{ id: string } | null>, [PositionEvent, unknown]>()
        .mockResolvedValue(null),
    };
    service = new IngestionService(
      repository as unknown as IngestionRepository,
      devices as unknown as DevicesService,
      contracts as unknown as ContractsService,
      incidents as unknown as IncidentIngress,
      new Normalizer(),
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
      stations as unknown as FieldStationsService,
    );
  });

  const audits = () =>
    repository.insertAudit.mock.calls.map(([row]) => (row as { outcome: string }).outcome);
  const storedEvent = () => repository.insertEventOnce.mock.calls[0][0];

  describe('attribution (task 2.4, D-040)', () => {
    const custody = {
      contractDeviceId: 'cd-9',
      contractId: 'c-1',
      organizationId: 'org-1',
      contractStatus: 'ACTIVE',
      handedOverAt: new Date('2026-10-20T02:00:00Z'),
      endedAt: null,
    };

    it('attributes an event inside a custody interval to its organization and interval', async () => {
      contracts.custodyAt.mockResolvedValue(custody);
      await expect(service.ingest(envelopeOf('position'))).resolves.toBe('ACCEPTED');
      expect(contracts.custodyAt).toHaveBeenCalledWith(
        'dev-9',
        new Date('2026-10-23T03:00:00.000Z'),
      );
      expect(storedEvent()).toMatchObject({
        attribution: 'ATTRIBUTED',
        organizationId: 'org-1',
        contractDeviceId: 'cd-9',
      });
      expect(audits()).toEqual(['ACCEPTED']);
      expect(repository.insertAudit.mock.calls[0][0].detail).toBeUndefined();
      expect(emitted[0]).toMatchObject({
        name: 'field.position',
        payload: { organizationId: 'org-1' },
      });
    });

    it('names NO_INTERVAL in the audit detail of an event outside every interval', async () => {
      await expect(service.ingest(envelopeOf('position'))).resolves.toBe('ACCEPTED_UNATTRIBUTED');
      expect(repository.insertAudit.mock.calls[0][0]).toMatchObject({
        outcome: 'ACCEPTED_UNATTRIBUTED',
        detail: 'NO_INTERVAL: no custody interval holds the device at the occurrence time',
      });
    });

    it('hands an attributed SOS to incidents with its contract and organization (MF-03)', async () => {
      contracts.custodyAt.mockResolvedValue(custody);
      await expect(service.ingest(envelopeOf('sos-fall'))).resolves.toBe('ACCEPTED');
      expect(incidents.onSos).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', contractId: 'c-1' }),
        tx,
      );
      expect(repository.linkIncident).toHaveBeenCalledTimes(1);
    });

    it('leaves an event near a handover or check-in UNATTRIBUTED (margin)', async () => {
      // The position fixture occurred at 03:00:00; the handover was 60 s before it, inside 300 s.
      contracts.custodyAt.mockResolvedValue({
        ...custody,
        handedOverAt: new Date('2026-10-23T02:59:00Z'),
      });
      await expect(service.ingest(envelopeOf('position'))).resolves.toBe('ACCEPTED_UNATTRIBUTED');
      expect(storedEvent()).toMatchObject({
        attribution: 'UNATTRIBUTED',
        organizationId: null,
        contractDeviceId: null,
      });
      expect(repository.insertAudit.mock.calls[0][0].detail).toMatch(/^NEAR_HANDOVER: /);
    });

    it('names NEAR_END in the audit detail of an event just before a check-in', async () => {
      contracts.custodyAt.mockResolvedValue({
        ...custody,
        endedAt: new Date('2026-10-23T03:01:00Z'),
      });
      await expect(service.ingest(envelopeOf('position'))).resolves.toBe('ACCEPTED_UNATTRIBUTED');
      expect(repository.insertAudit.mock.calls[0][0].detail).toMatch(/^NEAR_END: /);
    });

    it('keeps the reason off a row whose outcome is not ACCEPTED_UNATTRIBUTED', async () => {
      // A duplicate is audited DUPLICATE_REJECTED with no attribution detail.
      repository.insertEventOnce.mockResolvedValue(false);
      await expect(service.ingest(envelopeOf('position'))).resolves.toBe('DUPLICATE_REJECTED');
      expect(repository.insertAudit.mock.calls[0][0].detail).toBeUndefined();
    });
  });

  describe('Field Station events (REQ-EVT-05, REQ-EVT-15, E02-7)', () => {
    const stationA = {
      id: 'fs-a',
      organizationId: 'org-a',
      mqttUsername: 'fs-org-a-1',
      secretHash: 'hash',
      revokedAt: null,
    };
    // A's interval ended at the check-in 2026-10-23 20:00, six hours before the flush.
    const intervalA = {
      contractDeviceId: 'cd-a',
      contractId: 'c-a',
      organizationId: 'org-a',
      contractStatus: 'CLOSED',
      handedOverAt: new Date('2026-10-20T02:00:00Z'),
      endedAt: new Date('2026-10-23T20:00:00Z'),
    };
    const periodA = {
      contractId: 'c-a',
      from: new Date('2026-10-20T02:00:00Z'),
      to: new Date('2026-10-23T20:00:00Z'),
    };

    beforeEach(() => {
      stations.byUsername.mockResolvedValue(stationA);
      contracts.rentalPeriods.mockResolvedValue([periodA]);
    });

    it('attributes an SOS captured in custody of the station organization to that interval', async () => {
      contracts.custodyAt.mockResolvedValue(intervalA);
      await expect(service.ingest(stationEnvelope())).resolves.toBe('ACCEPTED');

      expect(stations.byUsername).toHaveBeenCalledWith('fs-org-a-1');
      expect(contracts.rentalPeriods).toHaveBeenCalledWith('dev-9', 'org-a');
      expect(contracts.custodyAt).toHaveBeenCalledWith('dev-9', new Date('2026-10-23T03:00:00Z'));
      expect(storedEvent()).toMatchObject({
        ingress: 'FIELD_STATION',
        uplinkKey: 'fs-org-a-1',
        fieldStationId: 'fs-a',
        capturedAt: new Date('2026-10-23T06:00:00Z'),
        occurredAt: new Date('2026-10-23T03:00:00Z'),
        timeSource: 'STATION_CORRECTED',
        attribution: 'ATTRIBUTED',
        organizationId: 'org-a',
        contractDeviceId: 'cd-a',
      });
      expect(incidents.onSos).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', contractId: 'c-a' }),
        tx,
      );
      expect(audits()).toEqual(['ACCEPTED']);
    });

    it('leaves an event in another organization interval UNATTRIBUTED (REQ-ERR-06)', async () => {
      contracts.custodyAt.mockResolvedValue({
        ...intervalA,
        contractDeviceId: 'cd-b',
        contractId: 'c-b',
        organizationId: 'org-b',
        endedAt: null,
      });
      await expect(service.ingest(stationEnvelope())).resolves.toBe('ACCEPTED_UNATTRIBUTED');
      expect(storedEvent()).toMatchObject({
        attribution: 'UNATTRIBUTED',
        organizationId: null,
        contractDeviceId: null,
        fieldStationId: 'fs-a',
      });
      expect(incidents.onSos).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: null, contractId: null }),
        tx,
      );
      expect(audits()).toEqual(['ACCEPTED_UNATTRIBUTED']);
      expect(repository.insertAudit.mock.calls[0][0].detail).toMatch(
        /^STATION_ORGANIZATION_DIFFERS: /,
      );
    });

    it('accepts a device its organization holds now', async () => {
      contracts.rentalPeriods.mockResolvedValue([{ ...periodA, to: null }]);
      contracts.custodyAt.mockResolvedValue({ ...intervalA, endedAt: null });
      await expect(service.ingest(stationEnvelope())).resolves.toBe('ACCEPTED');
    });

    it.each([
      [
        'returned past the late-upload grace (AC-08)',
        [{ ...periodA, to: new Date('2026-10-16T01:59:00Z') }],
      ],
      ['never held by the station organization (AC-04)', []],
    ])('audits NOT_RENTED_TO_STATION_ORG for a device %s', async (_label, periods) => {
      contracts.rentalPeriods.mockResolvedValue(periods);
      await expect(service.ingest(stationEnvelope())).resolves.toBe('NOT_RENTED_TO_STATION_ORG');
      expect(repository.insertEventOnce).not.toHaveBeenCalled();
      expect(contracts.custodyAt).not.toHaveBeenCalled();
      expect(incidents.onSos).not.toHaveBeenCalled();
      expect(repository.insertAudit.mock.calls[0][0]).toMatchObject({
        ingress: 'FIELD_STATION',
        uplinkKey: 'fs-org-a-1',
        deviceId: 'dev-9',
        outcome: 'NOT_RENTED_TO_STATION_ORG',
      });
    });

    it.each([
      ['unknown', null, 'unknown Field Station fs-org-a-1'],
      [
        'revoked',
        { ...stationA, revokedAt: new Date('2026-10-23T00:00:00Z') },
        'Field Station fs-org-a-1 is revoked',
      ],
    ])('refuses an %s station before reading custody', async (_label, row, detail) => {
      stations.byUsername.mockResolvedValue(row);
      await expect(service.ingest(stationEnvelope())).resolves.toBe('NOT_RENTED_TO_STATION_ORG');
      expect(contracts.rentalPeriods).not.toHaveBeenCalled();
      expect(repository.insertEventOnce).not.toHaveBeenCalled();
      expect(repository.insertAudit.mock.calls[0][0]).toMatchObject({ detail });
    });

    it('never resolves a station for a node uplink', async () => {
      await service.ingest(envelopeOf('position'));
      expect(stations.byUsername).not.toHaveBeenCalled();
      expect(storedEvent()).toMatchObject({ fieldStationId: null, capturedAt: null });
    });
  });

  it('derives eventId as sha256 of "from:id" in lower-case hex (D-006)', () => {
    expect(eventIdOf(3724541961, 1834576211)).toBe(
      createHash('sha256').update('3724541961:1834576211').digest('hex'),
    );
  });

  it('stores a position UNATTRIBUTED, projects it and emits field.position after commit', async () => {
    await expect(service.ingest(envelopeOf('position'))).resolves.toBe('ACCEPTED_UNATTRIBUTED');

    expect(storedEvent()).toMatchObject({
      eventId: eventIdOf(0xde000009, 1834576211),
      deviceId: 'dev-9',
      attribution: 'UNATTRIBUTED',
      ingress: 'MQTT_NODE',
      uplinkKey: '!de000009',
      kind: 'POSITION',
      priority: 'P2_GPS',
      timeSource: 'DEVICE_RTC',
      occurredAt: new Date('2026-10-23T03:00:00Z'),
      latitude: 11.5544,
      longitude: 108.5381,
      altitude: 1320,
      plotted: true,
      rssi: -97,
    });
    expect(devices.projectReading).toHaveBeenCalledWith(
      0xde000009n,
      {
        at: new Date('2026-10-23T03:00:00Z'),
        position: { latitude: 11.5544, longitude: 108.5381, altitude: 1320 },
        batteryPct: undefined,
      },
      tx,
    );
    expect(audits()).toEqual(['ACCEPTED_UNATTRIBUTED']);
    expect(incidents.onPosition).toHaveBeenCalledWith(
      {
        deviceId: 'dev-9',
        occurredAt: new Date('2026-10-23T03:00:00Z'),
        latitude: 11.5544,
        longitude: 108.5381,
      },
      tx,
    );
    expect(repository.linkIncident).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      {
        name: 'field.position',
        payload: {
          deviceId: 'dev-9',
          organizationId: null,
          lat: 11.5544,
          lon: 108.5381,
          at: '2026-10-23T03:00:00.000Z',
          plotted: true,
        },
      },
    ]);
  });

  it('links a position to the incident episode it joined (MF-03)', async () => {
    incidents.onPosition.mockResolvedValue({ id: 'incident-7' });
    await service.ingest(envelopeOf('position'));
    expect(repository.linkIncident).toHaveBeenCalledWith(
      (storedEvent() as { eventId: string }).eventId,
      'incident-7',
      tx,
    );
  });

  it('projects telemetry and emits field.telemetry', async () => {
    await service.ingest(envelopeOf('telemetry'));
    expect(storedEvent()).toMatchObject({
      kind: 'TELEMETRY',
      priority: 'P3_TELEMETRY',
      batteryPct: 87,
    });
    expect(devices.projectReading).toHaveBeenCalledWith(
      0xde000009n,
      expect.objectContaining({ batteryPct: 87, position: undefined }),
      tx,
    );
    expect(emitted.map((e) => e.name)).toEqual(['field.telemetry']);
  });

  it('stores an SOS as P0 without projecting or emitting', async () => {
    devices.byNodeNum.mockResolvedValue({ ...device, id: 'dev-10' });
    await expect(service.ingest(envelopeOf('sos-fall'))).resolves.toBe('ACCEPTED_UNATTRIBUTED');
    expect(storedEvent()).toMatchObject({ kind: 'FALL_SOS', priority: 'P0_SOS', latitude: null });
    expect(incidents.onSos).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'dev-10',
        source: 'DEVICE_FALL',
        organizationId: null,
        contractId: null,
      }),
      tx,
    );
    expect(incidents.onPosition).not.toHaveBeenCalled();
    expect(repository.linkIncident).toHaveBeenCalledWith(
      (storedEvent() as { eventId: string }).eventId,
      'incident-1',
      tx,
    );
    expect(devices.projectReading).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('changes nothing but the audit for a duplicate eventId (REQ-ERR-02, AC-02)', async () => {
    repository.insertEventOnce.mockResolvedValue(false);
    await expect(service.ingest(envelopeOf('position'))).resolves.toBe('DUPLICATE_REJECTED');
    expect(devices.projectReading).not.toHaveBeenCalled();
    expect(audits()).toEqual(['DUPLICATE_REJECTED']);
    expect(emitted).toEqual([]);
  });

  it('quarantines an unknown node with its raw message', async () => {
    devices.byNodeNum.mockResolvedValue(null);
    await expect(service.ingest(envelopeOf('unknown-device'))).resolves.toBe('UNKNOWN_DEVICE');
    expect(repository.insertEventOnce).not.toHaveBeenCalled();
    expect(repository.insertAudit.mock.calls[0][0]).toMatchObject({
      outcome: 'UNKNOWN_DEVICE',
      nodeNum: 0xde0000ffn,
      rawMessage: expect.objectContaining({ from: 0xde0000ff }) as unknown,
    });
  });

  it('keeps an out-of-bounds position without coordinates and still counts the device heard', async () => {
    await expect(service.ingest(envelopeOf('invalid-position'))).resolves.toBe('INVALID_POSITION');
    expect(storedEvent()).toMatchObject({
      kind: 'POSITION',
      latitude: null,
      longitude: null,
      plotted: true,
    });
    expect(devices.projectReading).toHaveBeenCalledWith(
      0xde000009n,
      expect.objectContaining({ position: undefined }),
      tx,
    );
    expect(emitted).toEqual([]);
  });

  it('keeps an implausible move unplotted and does not project it (E04-6)', async () => {
    repository.lastPlottedPosition.mockResolvedValue({
      latitude: 11.0,
      longitude: 108.0,
      occurredAt: new Date('2026-10-23T02:59:00Z'),
    });
    await expect(service.ingest(envelopeOf('position'))).resolves.toBe('IMPLAUSIBLE_POSITION');
    expect(storedEvent()).toMatchObject({ plotted: false, latitude: 11.5544 });
    expect(devices.projectReading).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ name: 'field.position', payload: { plotted: false } });
  });

  it('stores rx_time 0 as unknown with SERVER_RECEIPT time', async () => {
    await service.ingest(envelopeOf('rx-time-zero'));
    expect(storedEvent()).toMatchObject({
      observedAt: null,
      occurredAt: receivedAt,
      timeSource: 'SERVER_RECEIPT',
    });
  });

  it('audits NORMALIZATION_FAILED for that packet only (REQ-ERR-05)', async () => {
    const envelope = envelopeOf('chat');
    envelope.packet.payload = {};
    await expect(service.ingest(envelope)).resolves.toBe('NORMALIZATION_FAILED');
    expect(repository.insertEventOnce).not.toHaveBeenCalled();
    expect(repository.insertAudit.mock.calls[0][0]).toMatchObject({
      outcome: 'NORMALIZATION_FAILED',
      deviceId: 'dev-9',
      detail: 'text payload has no text',
    });
  });

  it('audits a malformed message raw (REQ-ERR-01)', async () => {
    await expect(
      service.rejectMalformed('MQTT_NODE', '!de000009', 'message is not JSON', '{"id"'),
    ).resolves.toBe('MALFORMED_ENVELOPE');
    expect(repository.insertAudit).toHaveBeenCalledWith({
      ingress: 'MQTT_NODE',
      uplinkKey: '!de000009',
      outcome: 'MALFORMED_ENVELOPE',
      detail: 'message is not JSON',
      rawMessage: '{"id"',
    });
  });
});
