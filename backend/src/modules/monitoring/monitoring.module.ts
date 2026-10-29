import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { PlatformModule } from '../platform/platform.module';
import { PruneStreamJob } from './jobs/prune-stream.job';
import { LiveMapService } from './live-map.service';
import { MapController } from './map.controller';
import { LiveGateway } from './live.gateway';
import { ReplayService } from './replay.service';
import { StreamListener } from './stream.listener';
import { StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

// The read model of the platform (specs/monitoring/design.md). Task 1.1: the stream store and the
// `/live` gateway; task 2.1 adds the stream listeners, task 2.2 replay, task 2.4 the stream pruning job and
// task 3.1 the map configuration. The staleness sweep and the other REST endpoints join with tasks 2.x and 3.x.
@Module({
  imports: [AuthModule, PlatformModule],
  controllers: [MapController],
  providers: [
    StreamRepository,
    StreamService,
    StreamListener,
    ReplayService,
    LiveGateway,
    LiveMapService,
    PruneStreamJob,
  ],
  exports: [StreamService],
})
export class MonitoringModule {}
