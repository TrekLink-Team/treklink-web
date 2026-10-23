import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { NodeJsonAdapter } from '../adapters/node-json.adapter';
import { IngestionService } from '../ingestion.service';
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
