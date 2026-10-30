import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import {
  Authenticated,
  Caller,
  CheckPolicies,
  CurrentAbility,
  CurrentCaller,
  type PolicyAbility,
} from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { LiveMapService, MapSnapshotDto } from './live-map.service';

export class MapSnapshotQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

// The map endpoints of `monitoring` (api-design 01 and 02). Config is for any signed-in user, so the
// token is checked by the global guard and no permission is. The snapshot needs `read LiveMap`
// (`liveMap.read` for Staff, `liveMap.read.own` for members); the service narrows it to the
// caller's organization.
@Controller('map')
export class MapController {
  constructor(private readonly liveMap: LiveMapService) {}

  @Get('config')
  @Authenticated()
  @ResponseMessage('OK')
  config() {
    return this.liveMap.config();
  }

  @Get('snapshot')
  @CheckPolicies((ability) => ability.can('read', 'LiveMap'))
  @ResponseMessage('OK')
  snapshot(
    @Query() query: MapSnapshotQueryDto,
    @CurrentCaller() caller: Caller,
    @CurrentAbility() ability: PolicyAbility,
  ): Promise<MapSnapshotDto> {
    return this.liveMap.snapshot(query, caller, ability);
  }
}
