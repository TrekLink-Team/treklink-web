import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth';
import { BillingModule } from './modules/billing';
import {
  DemoAccountsModule,
  DemoModule,
  DemoSimulationModule,
  demoControlsEnabled,
  demoPanelSimulationEnabled,
  demoTestAccountsEnabled,
} from './modules/demo';
import { DevicesModule } from './modules/devices';
import {
  FieldSimulatorModule,
  GatewaySyncModule,
  fieldSimulatorEnabled,
} from './modules/gateway-sync';
import { IncidentsModule } from './modules/incidents';
import { MonitoringModule } from './modules/monitoring';
import { OrganizationsModule } from './modules/organizations';
import { validate } from './modules/platform/config/environment-variables';
import { PlatformModule } from './modules/platform/platform.module';
import { RentalsModule } from './modules/rentals';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      validate,
    }),
    // Domain events of specs/platform/design.md §2.3, emitted after commit by TransactionalEvents.
    EventEmitterModule.forRoot(),
    // Hosts the @ScheduledJob methods registered by JobRunnerService (design §4.6).
    ScheduleModule.forRoot(),
    PrismaModule,
    PlatformModule,
    AuthModule,
    OrganizationsModule,
    DevicesModule,
    BillingModule,
    GatewaySyncModule,
    IncidentsModule,
    MonitoringModule,
    RentalsModule,
    // W43 controls require DEMO_CONTROLS_ENABLED and explicit VITE_APP_ENV sandbox/staging.
    ConditionalModule.registerWhen(DemoModule, demoControlsEnabled),
    // The read-only sandbox test accounts list (D-089), only when DEMO_TEST_ACCOUNTS_ENABLED is true,
    // in any NODE_ENV and on any database: GET /api/demo/accounts is a 404 otherwise.
    ConditionalModule.registerWhen(DemoAccountsModule, demoTestAccountsEnabled),
    // The field simulation of the demo panel (D-093 amendment, D-094), only when DEMO_SIMULATION_ENABLED is
    // true and the W43 panel gate passes; writes also require a local/staging database.
    ConditionalModule.registerWhen(DemoSimulationModule, demoPanelSimulationEnabled),
    // The field data simulator (gateway-sync design §2 (field data simulator), D-090), only when FIELD_SIMULATOR_ENABLED is true
    // (set on the Vercel production, which has no MQTT subscriber) or DEMO_SIMULATION_ENABLED is true.
    ConditionalModule.registerWhen(FieldSimulatorModule, fieldSimulatorEnabled),
  ],
})
export class AppModule {}
