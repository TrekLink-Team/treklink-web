import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { IntakeService } from './intake.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceRepository } from './maintenance.repository';
import { MaintenanceService } from './maintenance.service';

// Hardware variants, devices and their lifecycle (specs/devices/design.md). Built so far: the
// projection side ingestion needs (tasks 1.1 and 2.5), the reservation reads of rentals, the fleet,
// detail and availability endpoints, the return side of MF-05 (markReturned, reset, inspection), the
// intake check and maintenance records (tasks 2.2 and 2.8 parts). Variants, registration, loss cases
// and stock-take join with the rest of tasks 2.x and 4.1. `organizations` gives the label of the
// organization whose key a unit carries (Figure 3 edge devices --> organizations).
@Module({
  imports: [PlatformModule, OrganizationsModule],
  controllers: [DevicesController, MaintenanceController],
  providers: [
    DevicesRepository,
    DevicesService,
    MaintenanceRepository,
    MaintenanceService,
    IntakeService,
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
