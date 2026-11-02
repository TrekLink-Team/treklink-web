import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module';
import { GatewaySyncModule } from '../gateway-sync.module';
import { FieldSimulatorJob } from './field-simulator.job';

export const FIELD_SIMULATOR_FLAG = 'FIELD_SIMULATOR_ENABLED';
export const DEMO_SIMULATION_FLAG = 'DEMO_SIMULATION_ENABLED';

const isTrue = (value: string | undefined): boolean =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'true';

// The field simulation of the demo panel (specs/demo/requirements.md REQ-SIM-01, design §9): the
// simulator drives the simulated nodes of the table, and DemoSimulationModule is loaded.
export const demoSimulationEnabled = (env: NodeJS.ProcessEnv): boolean =>
  isTrue(env[DEMO_SIMULATION_FLAG]);

// The ConditionalModule condition of AppModule (design §2 (field data simulator), D-090 rule 2): the
// simulator is loaded only when FIELD_SIMULATOR_ENABLED or DEMO_SIMULATION_ENABLED reads `true`, so no
// other host schedules it (demo design §9, "Runs").
export const fieldSimulatorEnabled = (env: NodeJS.ProcessEnv): boolean =>
  isTrue(env[FIELD_SIMULATOR_FLAG]) || demoSimulationEnabled(env);

@Module({
  imports: [PlatformModule, GatewaySyncModule],
  providers: [FieldSimulatorJob],
})
export class FieldSimulatorModule {}
