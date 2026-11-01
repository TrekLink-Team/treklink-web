import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module';
import { GatewaySyncModule } from '../gateway-sync.module';
import { FieldSimulatorJob } from './field-simulator.job';

export const FIELD_SIMULATOR_FLAG = 'FIELD_SIMULATOR_ENABLED';

// The ConditionalModule condition of AppModule (design §2 (field data simulator), D-090 rule 2): the simulator is loaded only
// when the variable reads `true`, so no other host schedules it.
export const fieldSimulatorEnabled = (env: NodeJS.ProcessEnv): boolean =>
  String(env[FIELD_SIMULATOR_FLAG] ?? '')
    .trim()
    .toLowerCase() === 'true';

@Module({
  imports: [PlatformModule, GatewaySyncModule],
  providers: [FieldSimulatorJob],
})
export class FieldSimulatorModule {}
