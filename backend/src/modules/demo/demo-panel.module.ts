import { Module } from '@nestjs/common';
import { DemoPanelController } from './demo-panel.controller';
import { DemoPanelFailures } from './demo-panel-failures';
import { DemoPanelGuard } from './demo-panel.guard';
import { DemoPanelService } from './demo-panel.service';

// The demo panel for a defence (specs/demo/design.md §11, D-110). AppModule imports it only when
// DEMO_PANEL_PASSWORD_HASH parses (demoPanelEnabled), independently of the other demo flags.
@Module({
  controllers: [DemoPanelController],
  providers: [DemoPanelGuard, DemoPanelFailures, DemoPanelService],
})
export class DemoPanelModule {}
