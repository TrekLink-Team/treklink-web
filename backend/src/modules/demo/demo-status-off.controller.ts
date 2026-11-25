import { Controller, Get } from '@nestjs/common';
import { Authenticated } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { DemoStatus } from './demo-scenarios.service';

export interface DemoStatusView extends DemoStatus {
  quickEnabled: boolean;
  roleSwitchEnabled: boolean;
}

// The status of specs/demo api-design 01 with every field at its off value (D-113).
export const DEMO_STATUS_OFF: Readonly<DemoStatusView> = Object.freeze({
  enabled: false,
  quickEnabled: false,
  roleSwitchEnabled: false,
  databaseLocal: false,
  lastStaged: null,
});

// GET /api/demo/status while the demo controls are off (D-113, REQ-UBI-01): a 200 with the controls
// off, so a signed-in page logs no failed request. The token is checked by the global guard. Only
// this route; every other /api/demo route of DemoModule stays unrouted, so a 404.
@Controller('demo')
export class DemoStatusOffController {
  @Get('status')
  @Authenticated()
  @ResponseMessage('OK')
  status(): DemoStatusView {
    return { ...DEMO_STATUS_OFF };
  }
}
