import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DevicesModule } from '../devices';
import { GatewaySyncModule } from '../gateway-sync';
import { IncidentsModule } from '../incidents';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { ApiRateLimiter } from './api-rate-limiter';
import { DeviceHistoryController } from './device-history.controller';
import { DeviceHistoryService } from './device-history.service';
import { HistoryService } from './history.service';
import { PruneStreamJob } from './jobs/prune-stream.job';
import { StaleSweepJob } from './jobs/stale-sweep.job';
import { LiveMapService } from './live-map.service';
import { MapController } from './map.controller';
import { LiveGateway } from './live.gateway';
import { OrgApiController } from './org-api.controller';
import { OrgApiService } from './org-api.service';
import { ReplayService } from './replay.service';
import { StaleMarksRepository } from './stale-marks.repository';
import { StreamListener } from './stream.listener';
import { StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';
import { TelemetryHistoryController } from './telemetry-history.controller';

// The read model of the platform (specs/monitoring/design.md). Task 1.1: the stream store and the
// `/live` gateway; task 2.1 adds the stream listeners, task 2.2 replay, task 2.4 the stream pruning job and
// task 3.1 the map configuration and the snapshot, composed from the reads of rentals, devices,
// incidents and organizations. Task 3.2: the organization API (OrgApiController). The device history
// of api-design 07 reads devices, rentals and organizations, and the position and telemetry history of
// api-design 03 reads rentals, devices and the field-event ledger of gateway-sync (task 3.3). The staleness sweep
// (task 2.4) reads rentals, devices and organizations and stores its transitions in `stale_marks`.
@Module({
  imports: [
    AuthModule,
    PlatformModule,
    RentalsModule,
    DevicesModule,
    IncidentsModule,
    OrganizationsModule,
    GatewaySyncModule,
  ],
  controllers: [
    MapController,
    OrgApiController,
    DeviceHistoryController,
    TelemetryHistoryController,
  ],
  providers: [
    StreamRepository,
    StreamService,
    StreamListener,
    ReplayService,
    LiveGateway,
    LiveMapService,
    PruneStreamJob,
    StaleMarksRepository,
    StaleSweepJob,
    OrgApiService,
    ApiRateLimiter,
    DeviceHistoryService,
    HistoryService,
  ],
  exports: [StreamService],
})
export class MonitoringModule {}
