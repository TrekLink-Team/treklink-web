import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { PlatformModule } from '../platform/platform.module';
import { LiveMapService } from './live-map.service';
import { MapController } from './map.controller';
import { LiveGateway } from './live.gateway';
import { StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

// The read model of the platform (specs/monitoring/design.md). Task 1.1: the stream store and the
// `/live` gateway; task 3.1 adds the map configuration. Listeners, replay, jobs and the other REST
// endpoints join with tasks 2.x and 3.x.
@Module({
  imports: [AuthModule, PlatformModule],
  controllers: [MapController],
  providers: [StreamRepository, StreamService, LiveGateway, LiveMapService],
  exports: [StreamService],
})
export class MonitoringModule {}
