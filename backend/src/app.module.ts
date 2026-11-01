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
  demoControlsEnabled,
  demoTestAccountsEnabled,
} from './modules/demo';
import { DevicesModule } from './modules/devices';
import { GatewaySyncModule } from './modules/gateway-sync';
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
    // The local demo control panel (D-088), only when DEMO_CONTROLS_ENABLED is true: every /api/demo
    // route is a 404 otherwise.
    ConditionalModule.registerWhen(DemoModule, demoControlsEnabled),
    // The read-only sandbox test accounts list (D-089), only when DEMO_TEST_ACCOUNTS_ENABLED is true,
    // in any NODE_ENV and on any database: GET /api/demo/accounts is a 404 otherwise.
    ConditionalModule.registerWhen(DemoAccountsModule, demoTestAccountsEnabled),
  ],
})
export class AppModule {}
