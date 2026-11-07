import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { FieldStationJsonAdapter } from '../adapters/field-station-json.adapter';
import { NodeJsonAdapter } from '../adapters/node-json.adapter';
import { IngestionService } from '../ingestion.service';
import { StationHealthHandler } from '../station-health.handler';
import { fixture } from '../testing/fixtures';
import { MqttSubscriber } from './mqtt-subscriber';
import { backoffMs } from './retry';

const config = { get: () => 'treklink' } as unknown as ConfigService<ValidatedEnvironment, true>;

describe('MqttSubscriber.handle', () => {
  let ingestion: { ingest: jest.Mock; rejectMalformed: jest.Mock };
  let subscriber: MqttSubscriber;

  beforeEach(() => {
    jest.useFakeTimers();
    ingestion = {
      ingest: jest.fn().mockResolvedValue('ACCEPTED_UNATTRIBUTED'),
      rejectMalformed: jest.fn().mockResolvedValue('MALFORMED_ENVELOPE'),
    };
    subscriber = new MqttSubscriber(
      config,
      new NodeJsonAdapter(config),
      ingestion as unknown as IngestionService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('audits a malformed message, then ingests the next one (AC-05)', async () => {
    const [malformed] = fixture('malformed');
    const [position] = fixture('position');
    await subscriber.handle(malformed.topic, malformed.body);
    await subscriber.handle(position.topic, position.body);
    expect(ingestion.rejectMalformed).toHaveBeenCalledTimes(1);
    expect(ingestion.ingest).toHaveBeenCalledTimes(1);
  });

  it('ignores a type ingestion does not read, without an audit row', async () => {
    const [nodeinfo] = fixture('nodeinfo');
    await subscriber.handle(nodeinfo.topic, nodeinfo.body);
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(ingestion.rejectMalformed).not.toHaveBeenCalled();
  });

  it('retries while the database is unreachable and returns only once ingestion committed', async () => {
    const unreachable = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
      code: 'P1001',
      clientVersion: 'test',
    });
    ingestion.ingest
      .mockRejectedValueOnce(unreachable)
      .mockResolvedValueOnce('ACCEPTED_UNATTRIBUTED');
    const [position] = fixture('position');

    const handled = subscriber.handle(position.topic, position.body);
    await jest.advanceTimersByTimeAsync(backoffMs(0));
    await handled;
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
  });

  it('logs and acknowledges a non-transient failure instead of stalling the stream', async () => {
    ingestion.ingest.mockRejectedValueOnce(new Error('defect'));
    const [position] = fixture('position');
    await expect(subscriber.handle(position.topic, position.body)).resolves.toBeUndefined();
    expect(ingestion.ingest).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially up to 30 s', () => {
    expect([0, 1, 2, 5, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 30000, 30000]);
  });
});

describe('MqttSubscriber with the Field Station health handler', () => {
  it('routes a health topic to the handler and everything else to ingestion', async () => {
    const ingestion = {
      ingest: jest.fn().mockResolvedValue('ACCEPTED'),
      rejectMalformed: jest.fn(),
    };
    const health = {
      subscription: 'treklink/fs/+/health',
      matches: (topic: string) => topic.endsWith('/health'),
      handle: jest.fn().mockResolvedValue(true),
    };
    const subscriber = new MqttSubscriber(
      config,
      new NodeJsonAdapter(config),
      ingestion as unknown as IngestionService,
      null,
      health as unknown as StationHealthHandler,
    );
    const body = Buffer.from('{}');
    await subscriber.handle('treklink/fs/fs-org-0001-1/health', body);
    expect(health.handle).toHaveBeenCalledWith(
      'treklink/fs/fs-org-0001-1/health',
      body,
      expect.any(Date),
    );
    const [position] = fixture('position');
    await subscriber.handle(position.topic, position.body);
    expect(health.handle).toHaveBeenCalledTimes(1);
    expect(ingestion.ingest).toHaveBeenCalledTimes(1);
  });
});

// Design §4, review of treklink-web#431: the station data topic is subscribed and routed to the Stage C
// adapter only with MQTT_STATION_UPLINK_ENABLED.
describe('MqttSubscriber and MQTT_STATION_UPLINK_ENABLED', () => {
  const STATION_TOPIC = 'treklink/fs/fs-org-0001-1/2/json/LongFast/!de000009';
  const configWith = (flag: boolean) =>
    ({
      get: (key: string) => (key === 'MQTT_STATION_UPLINK_ENABLED' ? flag : 'treklink'),
    }) as unknown as ConfigService<ValidatedEnvironment, true>;
  const stationBody = (): Buffer => {
    const [position] = fixture('position');
    const message = JSON.parse(position.body.toString('utf8')) as Record<string, unknown>;
    return Buffer.from(
      JSON.stringify({ ...message, fs_captured_at: 1792724399000, fs_sent_at: 1792724400000 }),
    );
  };
  const subscriberWith = (flag: boolean, ingestion: object) => {
    const config = configWith(flag);
    return new MqttSubscriber(
      config,
      new NodeJsonAdapter(config),
      ingestion as unknown as IngestionService,
      null,
      undefined,
      new FieldStationJsonAdapter(config),
    );
  };
  const subscriptionsOf = (subscriber: MqttSubscriber) =>
    (subscriber as unknown as { subscriptions: string[] }).subscriptions;

  it('off: does not subscribe to the station data topic and does not ingest it', async () => {
    const ingestion = { ingest: jest.fn(), rejectMalformed: jest.fn() };
    const subscriber = subscriberWith(false, ingestion);
    expect(subscriptionsOf(subscriber)).toEqual(['treklink/2/json/+/+']);
    await subscriber.handle(STATION_TOPIC, stationBody());
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(ingestion.rejectMalformed).not.toHaveBeenCalled();
  });

  it('on: subscribes to it and hands a FIELD_STATION envelope with the station username to ingestion', async () => {
    const ingestion = {
      ingest: jest.fn().mockResolvedValue('ACCEPTED'),
      rejectMalformed: jest.fn(),
    };
    const subscriber = subscriberWith(true, ingestion);
    expect(subscriptionsOf(subscriber)).toEqual([
      'treklink/2/json/+/+',
      'treklink/fs/+/2/json/+/+',
    ]);
    await subscriber.handle(STATION_TOPIC, stationBody());
    expect(ingestion.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ ingress: 'FIELD_STATION', uplinkKey: 'fs-org-0001-1' }),
    );
    const [position] = fixture('position');
    await subscriber.handle(position.topic, position.body);
    expect(ingestion.ingest).toHaveBeenLastCalledWith(
      expect.objectContaining({ ingress: 'MQTT_NODE', uplinkKey: '!de000009' }),
    );
  });
});
