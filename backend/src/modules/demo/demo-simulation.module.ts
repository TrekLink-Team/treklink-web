import { Module } from '@nestjs/common';
import { GatewaySyncModule } from '../gateway-sync';
import { DemoSimulationController } from './demo-simulation.controller';
import { DemoSimulationGuard } from './demo-simulation.guard';

// The field simulation of the demo panel (specs/demo/design.md §9, D-093 amendment, D-094). AppModule
// imports it only when DEMO_SIMULATION_ENABLED is true, independently of DemoModule; it holds the routes
// and the database check, and calls FieldSimulationService of gateway-sync (the DEMO to gateway-sync edge
// of design Figure 1). It offers none of the control panel's resets.
@Module({
  imports: [GatewaySyncModule],
  controllers: [DemoSimulationController],
  providers: [DemoSimulationGuard],
})
export class DemoSimulationModule {}
