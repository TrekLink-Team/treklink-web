import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// Hardware variants, devices and their lifecycle (specs/devices/design.md). Only the projection side
// that ingestion needs exists so far (tasks 1.1 and 2.5), the reservation reads of rentals and the
// availability endpoint, and the return side of MF-05 (markReturned, reset, inspection); the other
// controllers join with task 4.x.
@Module({
  imports: [PlatformModule],
  controllers: [DevicesController],
  providers: [DevicesRepository, DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
