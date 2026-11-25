// Public surface of `demo` (D-088, D-089, D-113). Only AppModule imports it.
export { DemoModule } from './demo.module';
export { DemoStatusOffModule } from './demo-status-off.module';
export { DemoAccountsModule } from './demo-accounts.module';
export { DemoSimulationModule } from './demo-simulation.module';
export { DemoPanelModule } from './demo-panel.module';
export {
  DEMO_CONTROLS_FLAG,
  DEMO_SIMULATION_FLAG,
  DEMO_TEST_ACCOUNTS_FLAG,
  demoControlsDisabled,
  demoControlsEnabled,
  demoPanelEnabled,
  demoPanelSimulationEnabled,
  demoSimulationEnabled,
  demoTestAccountsEnabled,
} from './demo-flag';
