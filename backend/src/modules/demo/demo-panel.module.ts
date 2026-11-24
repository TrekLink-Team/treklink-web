import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { BillingModule } from '../billing';
import { DevicesModule } from '../devices';
import { GatewaySyncModule } from '../gateway-sync';
import { IncidentsModule } from '../incidents';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { DemoPanelController } from './demo-panel.controller';
import { DemoPanelFailures } from './demo-panel-failures';
import { DemoPanelGuard } from './demo-panel.guard';
import { DemoPanelPlayback } from './demo-panel-playback';
import { DemoPanelService } from './demo-panel.service';
import { DemoQuickRepository } from './demo-quick.repository';

// The demo panel for a defence (specs/demo/design.md §11, D-110). AppModule imports it only when
// DEMO_PANEL_PASSWORD_HASH parses (demoPanelEnabled), independently of the other demo flags. It reaches the
// other modules through the exported services of design Figure 1; the run registry is demo's own.
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
  controllers: [DemoPanelController],
  providers: [
    DemoPanelGuard,
    DemoPanelFailures,
    DemoPanelService,
    DemoPanelPlayback,
    DemoQuickRepository,
  ],
})
export class DemoPanelModule {}
