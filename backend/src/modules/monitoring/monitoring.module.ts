import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { LiveGateway } from './live.gateway';
import { StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

// The read model of the platform (specs/monitoring/design.md). Task 1.1: the stream store and the
// `/live` gateway; listeners, replay, jobs and the REST endpoints join with tasks 2.x and 3.x.
@Module({
  imports: [AuthModule],
  providers: [StreamRepository, StreamService, LiveGateway],
  exports: [StreamService],
})
export class MonitoringModule {}
