import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// Hardware variants, devices and their lifecycle (specs/devices/design.md). Only the projection side
// that ingestion needs exists so far (tasks 1.1 and 2.5), the reservation reads of rentals and the
// availability endpoint; the other controllers join with task 4.x.
@Module({
  controllers: [DevicesController],
  providers: [DevicesRepository, DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
