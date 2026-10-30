import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ChannelKeyService } from './channel-key.service';
import { RotateChannelKeyDto } from './dto/compliance.dto';

// api-design 27 (screen 3.6): `organization.rotateKey`, granted to TrekLink Staff and, through
// FR-AUTH-10 inheritance, to Admin.
@Controller('organizations')
export class ChannelKeyController {
  constructor(private readonly channelKey: ChannelKeyService) {}

  @Post(':id/channel-key/rotate')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('rotateKey', 'Organization'))
  @ResponseMessage('Channel key rotated')
  rotate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotateChannelKeyDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.channelKey.rotate(id, dto.reason.trim(), dto.expectedVersion, caller);
  }
}
