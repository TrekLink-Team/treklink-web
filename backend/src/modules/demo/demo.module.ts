import { DemoQuickController } from './demo-quick.controller';
import { DemoQuickService } from './demo-quick.service';
import { DemoQuickGuard } from './demo-quick.guard';
import { DemoQuickRepository } from './demo-quick.repository';
import { DemoQuickProfileService } from './demo-quick-profile.service';
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

// W43 demo controls: imported only with the flag and explicit sandbox/staging environment.
// It owns demo provenance and profile state only; business writes use exported services.
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
  controllers: [DemoController, DemoQuickController],
  providers: [
    DemoGuardService,
    DemoQuickService,
    DemoQuickGuard,
    DemoQuickRepository,
    DemoQuickProfileService,
    DemoResetRepository,
    DemoSeedRunner,
    DemoScenariosService,
    { provide: DEMO_SEED_LOADER, useValue: loadSeedModule },
  ],
})
export class DemoModule {}
