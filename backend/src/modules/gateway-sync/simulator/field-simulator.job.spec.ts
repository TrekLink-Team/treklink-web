import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { UplinkIngress } from '../uplink-ingress';
import { FieldSimulatorJob } from './field-simulator.job';
import { fieldSimulatorEnabled } from './field-simulator.module';

describe('FieldSimulatorJob (D-090 rule 2)', () => {
  const build = (values: Record<string, number>) => {
    const ingest = jest.fn((_topic: string, _body: Buffer, _at: Date) =>
      Promise.resolve('ingested' as const),
    );
    const job = new FieldSimulatorJob(
      { ingest } as unknown as UplinkIngress,
      { get: (key: string) => Promise.resolve(values[key]) } as unknown as ParameterService,
      { get: () => 'treklink' } as unknown as ConfigService<ValidatedEnvironment, true>,
    );
    return { job, ingest };
  };

  it('ingests the batch on the node uplink topics', async () => {
    const { job, ingest } = build({
      'gatewaySync.simulatorIntervalSeconds': 60,
      'gatewaySync.simulatorSosIntervalMinutes': 0,
    });
    await expect(job.run(new Date('2026-11-01T06:00:10Z'))).resolves.toBe(4);
    expect(ingest.mock.calls.map(([topic]) => topic)).toEqual([
      'treklink/2/json/LongFast/!de000009',
      'treklink/2/json/LongFast/!de000009',
      'treklink/2/json/LongFast/!de00000a',
      'treklink/2/json/LongFast/!de00000a',
    ]);
    expect(JSON.parse(ingest.mock.calls[0][1].toString())).toMatchObject({
      type: 'position',
      sender: '!de000009',
    });
  });

  it('is loaded only when FIELD_SIMULATOR_ENABLED reads true', () => {
    expect(fieldSimulatorEnabled({ FIELD_SIMULATOR_ENABLED: 'true' })).toBe(true);
    expect(fieldSimulatorEnabled({ FIELD_SIMULATOR_ENABLED: 'false' })).toBe(false);
    expect(fieldSimulatorEnabled({})).toBe(false);
  });
});
