// Public surface of `demo` (D-088, D-089). Only AppModule imports it.
export { DemoModule } from './demo.module';
export { DemoAccountsModule } from './demo-accounts.module';
export { DemoSimulationModule } from './demo-simulation.module';
export {
  DEMO_CONTROLS_FLAG,
  DEMO_SIMULATION_FLAG,
  DEMO_TEST_ACCOUNTS_FLAG,
  demoControlsEnabled,
  demoPanelSimulationEnabled,
  demoSimulationEnabled,
  demoTestAccountsEnabled,
} from './demo-flag';
