import { Controller, Get } from '@nestjs/common';
import { Authenticated } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { LiveMapService } from './live-map.service';

// The map endpoints of `monitoring` (api-design 01 and 02). Config is for any signed-in user, so the
// token is checked by the global guard and no permission is.
@Controller('map')
export class MapController {
  constructor(private readonly liveMap: LiveMapService) {}

  @Get('config')
  @Authenticated()
  @ResponseMessage('OK')
  config() {
    return this.liveMap.config();
  }
}
