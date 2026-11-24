import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DemoPanelGuard } from './demo-panel.guard';
import { DemoPanelService } from './demo-panel.service';

// The demo panel routes (specs/demo api-design 13 to 16, D-110). No account and no policy: @Public on the
// class skips the global JWT and policy guards, and DemoPanelGuard on the class requires the panel
// password on every route, reads included (REQ-PNL-02). demo-panel.controller.spec.ts enumerates the
// routes, so a route added without the guard fails it.
@Controller('demo/panel')
@Public()
@UseGuards(DemoPanelGuard)
export class DemoPanelController {
  constructor(private readonly panel: DemoPanelService) {}

  @Get()
  @ResponseMessage('OK')
  overview() {
    return this.panel.overview();
  }
}
