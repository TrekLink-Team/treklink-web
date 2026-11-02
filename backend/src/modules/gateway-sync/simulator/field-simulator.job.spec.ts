import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { UplinkIngress } from '../uplink-ingress';
import { FieldSimulationService } from './field-simulation.service';
import { FieldSimulatorJob } from './field-simulator.job';
import { fieldSimulatorEnabled } from './field-simulator.module';

describe('FieldSimulatorJob (D-090 rule 2)', () => {
  const build = (values: Record<string, number>, simulationTable = false) => {
    const ingest = jest.fn((_topic: string, _body: Buffer, _at: Date) =>
      Promise.resolve('ingested' as const),
    );
    const simulation = { run: jest.fn().mockResolvedValue(7) };
    const env: Record<string, unknown> = {
      MQTT_ROOT: 'treklink',
      DEMO_SIMULATION_ENABLED: simulationTable,
    };
    const job = new FieldSimulatorJob(
      { ingest } as unknown as UplinkIngress,
      { get: (key: string) => Promise.resolve(values[key]) } as unknown as ParameterService,
      { get: (key: string) => env[key] } as unknown as ConfigService<ValidatedEnvironment, true>,
      simulation as unknown as FieldSimulationService,
    );
    return { job, ingest, simulation };
  };

  it('drives the simulated nodes of the table instead while DEMO_SIMULATION_ENABLED is on (REQ-SIM-01)', async () => {
    const { job, ingest, simulation } = build({ 'gatewaySync.simulatorIntervalSeconds': 60 }, true);
    const now = new Date('2026-11-06T02:00:10Z');
    await expect(job.run(now)).resolves.toBe(7);
    expect(simulation.run).toHaveBeenCalledWith(now);
    expect(ingest).not.toHaveBeenCalled();
  });

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

  it('is loaded only when FIELD_SIMULATOR_ENABLED or DEMO_SIMULATION_ENABLED reads true', () => {
    expect(fieldSimulatorEnabled({ FIELD_SIMULATOR_ENABLED: 'true' })).toBe(true);
    expect(fieldSimulatorEnabled({ FIELD_SIMULATOR_ENABLED: 'false' })).toBe(false);
    expect(fieldSimulatorEnabled({ DEMO_SIMULATION_ENABLED: ' TRUE ' })).toBe(true);
    expect(fieldSimulatorEnabled({ DEMO_CONTROLS_ENABLED: 'true' })).toBe(false);
    expect(fieldSimulatorEnabled({})).toBe(false);
  });
});
