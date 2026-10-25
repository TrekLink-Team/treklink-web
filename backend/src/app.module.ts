import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth';
import { DevicesModule } from './modules/devices';
import { GatewaySyncModule } from './modules/gateway-sync';
import { IncidentsModule } from './modules/incidents';
import { MonitoringModule } from './modules/monitoring';
import { OrganizationsModule } from './modules/organizations';
import { validate } from './modules/platform/config/environment-variables';
import { PlatformModule } from './modules/platform/platform.module';

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
    GatewaySyncModule,
    IncidentsModule,
    MonitoringModule,
  ],
})
export class AppModule {}
