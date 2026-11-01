import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { BillingModule } from '../billing';
import { DevicesModule } from '../devices';
import { GatewaySyncModule } from '../gateway-sync';
import { IncidentsModule } from '../incidents';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { DemoController } from './demo.controller';
import { DemoGuardService } from './demo-guard.service';
import { DemoResetRepository } from './demo-reset.repository';
import { DemoScenariosService } from './demo-scenarios.service';
import { DEMO_SEED_LOADER, DemoSeedRunner, loadSeedModule } from './demo-seed.runner';

// The local demo control panel (specs/demo/design.md, D-088). AppModule imports it only when
// DEMO_CONTROLS_ENABLED is true. It owns no model and nothing depends on it.
@Module({
  imports: [
    PlatformModule,
    AuthModule,
    OrganizationsModule,
    DevicesModule,
    BillingModule,
    RentalsModule,
    IncidentsModule,
    GatewaySyncModule,
  ],
  controllers: [DemoController],
  providers: [
    DemoGuardService,
    DemoResetRepository,
    DemoSeedRunner,
    DemoScenariosService,
    { provide: DEMO_SEED_LOADER, useValue: loadSeedModule },
  ],
})
export class DemoModule {}
