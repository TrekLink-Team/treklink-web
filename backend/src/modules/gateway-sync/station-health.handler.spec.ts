import { ConfigService } from '@nestjs/config';
import { FieldStationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import {
  corrected,
  parseStationHealth,
  STATION_HEALTH_SCHEMA,
  StationHealthHandler,
} from './station-health.handler';

const config = { get: () => 'treklink' } as unknown as ConfigService<ValidatedEnvironment, true>;
const TOPIC = 'treklink/fs/fs-org-0001-1/health';
const receivedAt = new Date('2026-11-01T03:15:10.000Z');

const report = (overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      schema: STATION_HEALTH_SCHEMA,
      v: 1,
      version: '0.1.0',
      depth: [1, 0, 12, 12],
      oldest_attempts: 2,
      last_flush_at: 1_000_000_000_000,
      sent_at: 1_000_000_005_000,
      ...overrides,
    }),
  );

describe('parseStationHealth (mqtt-ingress-contract.md, Field Station health)', () => {
  it('reads a report of the contract', () => {
    expect(parseStationHealth(report())).toEqual({
      version: '0.1.0',
      depth: [1, 0, 12, 12],
      oldestAttempts: 2,
      lastFlushAt: 1_000_000_000_000,
      sentAt: 1_000_000_005_000,
    });
  });

  it('accepts null for the oldest attempts and the last flush', () => {
    expect(
      parseStationHealth(report({ oldest_attempts: null, last_flush_at: null })),
    ).toMatchObject({
      oldestAttempts: null,
      lastFlushAt: null,
    });
  });

  it.each([
    ['not JSON', Buffer.from('{')],
    ['an array', Buffer.from('[]')],
    ['another schema', report({ schema: 'treklink.queue_health' })],
    ['another version', report({ v: 2 })],
    ['an empty version string', report({ version: '' })],
    ['a version string over 64 characters', report({ version: 'x'.repeat(65) })],
    ['three tiers', report({ depth: [0, 0, 0] })],
    ['a negative depth', report({ depth: [0, -1, 0, 0] })],
    ['a fractional attempt count', report({ oldest_attempts: 1.5 })],
    ['a zero flush time', report({ last_flush_at: 0 })],
    ['no send time', report({ sent_at: undefined })],
  ])('refuses %s', (_case, body) => {
    expect(parseStationHealth(body)).toBeNull();
  });
});

describe('corrected (D-040 clock offset)', () => {
  it('moves a station time by the offset of the publish', () => {
    // The station clock is 1 hour behind: sent_at is receipt minus 1 h, the flush 5 s before that.
    const sentAt = receivedAt.getTime() - 3_600_000;
    expect(corrected(sentAt - 5_000, sentAt, receivedAt)).toEqual(
      new Date(receivedAt.getTime() - 5_000),
    );
  });

  it('never yields a time after receipt', () => {
    expect(corrected(2_000, 1_000, receivedAt)).toEqual(receivedAt);
  });
});

describe('StationHealthHandler (task 2.5, health part)', () => {
  let stations: { byUsername: jest.Mock; recordStationHealth: jest.Mock };
  let handler: StationHealthHandler;

  beforeEach(() => {
    stations = {
      byUsername: jest
        .fn()
        .mockResolvedValue({ id: 'fs-1', organizationId: 'org-1', revokedAt: null }),
      recordStationHealth: jest.fn().mockResolvedValue(undefined),
    };
    handler = new StationHealthHandler(config, stations as unknown as FieldStationsService);
  });

  it('subscribes to the health topic of every station under the root', () => {
    expect(handler.subscription).toBe('treklink/fs/+/health');
    expect(handler.matches(TOPIC)).toBe(true);
    expect(handler.matches('treklink/2/json/LongFast/!de000009')).toBe(false);
    expect(handler.matches('treklink/fs/fs-org-0001-1/2/json/LongFast/!de000009')).toBe(false);
  });

  it('records the health projection with the receipt time and the corrected flush time', async () => {
    await expect(handler.handle(TOPIC, report(), receivedAt)).resolves.toBe(true);
    expect(stations.byUsername).toHaveBeenCalledWith('fs-org-0001-1');
    expect(stations.recordStationHealth).toHaveBeenCalledWith('fs-1', {
      at: receivedAt,
      queueDepth: [1, 0, 12, 12],
      oldestRetryCount: 2,
      version: '0.1.0',
      lastFlushAt: new Date(receivedAt.getTime() - 5_000),
    });
  });

  it('keeps a null last flush', async () => {
    await handler.handle(TOPIC, report({ last_flush_at: null }), receivedAt);
    const [, health] = stations.recordStationHealth.mock.calls[0] as [
      string,
      { lastFlushAt: unknown },
    ];
    expect(health.lastFlushAt).toBeNull();
  });

  it('records no pending retries when the queue is empty', async () => {
    await handler.handle(TOPIC, report({ oldest_attempts: null }), receivedAt);
    const [, health] = stations.recordStationHealth.mock.calls[0] as [
      string,
      { oldestRetryCount: unknown },
    ];
    expect(health.oldestRetryCount).toBe(0);
  });

  it('drops a report that does not match the contract', async () => {
    await expect(handler.handle(TOPIC, Buffer.from('nope'), receivedAt)).resolves.toBe(false);
    expect(stations.byUsername).not.toHaveBeenCalled();
  });

  it('drops a topic that is not a health topic', async () => {
    await expect(handler.handle('treklink/other', report(), receivedAt)).resolves.toBe(false);
  });

  it.each([
    ['an unknown username', null],
    ['a revoked station', { id: 'fs-1', organizationId: 'org-1', revokedAt: receivedAt }],
  ])('drops the report of %s', async (_case, station) => {
    stations.byUsername.mockResolvedValue(station);
    await expect(handler.handle(TOPIC, report(), receivedAt)).resolves.toBe(false);
    expect(stations.recordStationHealth).not.toHaveBeenCalled();
  });
});
