import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ValidatedEnvironment } from '../config/environment-variables';
import { HealthService } from './health.service';
import { MqttHealthProbe } from './mqtt-health-probe';

const TIMEOUT_MS = 2000;
const backendVersion = (
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

const serviceWith = (queryRaw: jest.Mock, probe?: MqttHealthProbe): HealthService => {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'HEALTH_DB_TIMEOUT_MS' ? TIMEOUT_MS : undefined),
  } as unknown as ConfigService<ValidatedEnvironment, true>;
  return new HealthService(prisma, config, probe);
};

const probe = (connected: boolean | Error): MqttHealthProbe => ({
  isConnected: () => {
    if (connected instanceof Error) throw connected;
    return connected;
  },
});

const expectServiceUnavailable = async (pending: Promise<unknown>) => {
  const error: unknown = await pending.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).getStatus()).toBe(503);
  expect((error as DomainException).errorCode).toBe(ErrorCode.SERVICE_UNAVAILABLE);
  expect((error as DomainException).message).toBe('Database unreachable.');
};

describe('HealthService', () => {
  let warnLog: jest.SpyInstance;

  beforeEach(() => {
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    warnLog.mockRestore();
  });

  it('reports ok with mqtt unknown while no MQTT probe is registered (D-032)', async () => {
    const report = await serviceWith(jest.fn().mockResolvedValue([{ '?column?': 1 }])).check();

    expect(report).toEqual({
      status: 'ok',
      uptimeSeconds: expect.any(Number) as number,
      components: { database: 'up', mqtt: 'unknown' },
      version: backendVersion,
    });
    expect(Number.isInteger(report.uptimeSeconds)).toBe(true);
  });

  it('reports ok with mqtt up when the probe is connected', async () => {
    const report = await serviceWith(jest.fn().mockResolvedValue([]), probe(true)).check();

    expect(report.status).toBe('ok');
    expect(report.components.mqtt).toBe('up');
  });

  it('reports degraded with mqtt down when the probe is disconnected', async () => {
    const report = await serviceWith(jest.fn().mockResolvedValue([]), probe(false)).check();

    expect(report.status).toBe('degraded');
    expect(report.components).toEqual({ database: 'up', mqtt: 'down' });
  });

  it('treats a probe that throws as mqtt down', async () => {
    const report = await serviceWith(
      jest.fn().mockResolvedValue([]),
      probe(new Error('adapter not started')),
    ).check();

    expect(report.status).toBe('degraded');
    expect(report.components.mqtt).toBe('down');
  });

  it('fails with 503 SERVICE_UNAVAILABLE when the database query fails', async () => {
    await expectServiceUnavailable(
      serviceWith(jest.fn().mockRejectedValue(new Error('connection refused'))).check(),
    );
  });

  it('fails with 503 SERVICE_UNAVAILABLE when the database exceeds HEALTH_DB_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    const pending = serviceWith(jest.fn().mockReturnValue(new Promise(() => undefined))).check();
    // Attach the rejection handler before the timer fires.
    const asserted = expectServiceUnavailable(pending);

    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);

    await asserted;
  });

  it('does not fail before HEALTH_DB_TIMEOUT_MS has elapsed', async () => {
    jest.useFakeTimers();
    let resolveQuery: (rows: unknown[]) => void = () => undefined;
    const query = new Promise<unknown[]>((resolve) => (resolveQuery = resolve));
    const pending = serviceWith(jest.fn().mockReturnValue(query)).check();

    await jest.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    resolveQuery([]);

    await expect(pending).resolves.toMatchObject({ status: 'ok' });
  });

  it('checks the database before reading the MQTT probe', async () => {
    const isConnected = jest.fn().mockReturnValue(true);

    await expectServiceUnavailable(
      serviceWith(jest.fn().mockRejectedValue(new Error('down')), { isConnected }).check(),
    );
    expect(isConnected).not.toHaveBeenCalled();
  });
});
