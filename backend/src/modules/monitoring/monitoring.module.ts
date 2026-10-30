import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DevicesModule } from '../devices';
import { IncidentsModule } from '../incidents';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { ApiRateLimiter } from './api-rate-limiter';
import { PruneStreamJob } from './jobs/prune-stream.job';
import { LiveMapService } from './live-map.service';
import { MapController } from './map.controller';
import { LiveGateway } from './live.gateway';
import { OrgApiController } from './org-api.controller';
import { OrgApiService } from './org-api.service';
import { ReplayService } from './replay.service';
import { StreamListener } from './stream.listener';
import { StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

// The read model of the platform (specs/monitoring/design.md). Task 1.1: the stream store and the
// `/live` gateway; task 2.1 adds the stream listeners, task 2.2 replay, task 2.4 the stream pruning job and
// task 3.1 the map configuration. Task 3.2: the organization API (OrgApiController). The staleness sweep and
// the other REST endpoints join with tasks 2.x and 3.x.
@Module({
  imports: [AuthModule, PlatformModule, RentalsModule, DevicesModule, IncidentsModule],
  controllers: [MapController, OrgApiController],
  providers: [
    StreamRepository,
    StreamService,
    StreamListener,
    ReplayService,
    LiveGateway,
    LiveMapService,
    PruneStreamJob,
    OrgApiService,
    ApiRateLimiter,
  ],
  exports: [StreamService],
})
export class MonitoringModule {}
