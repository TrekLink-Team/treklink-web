import { Module } from '@nestjs/common';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// Hardware variants, devices and their lifecycle (specs/devices/design.md). Only the projection side
// that ingestion needs exists so far (tasks 1.1 and 2.5); controllers join with task 4.x.
@Module({
  providers: [DevicesRepository, DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
