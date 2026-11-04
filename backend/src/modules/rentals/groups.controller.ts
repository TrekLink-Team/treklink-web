import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CreateGroupDto, GroupQueryDto, UpdateGroupDto } from './dto/groups.dto';
import { GroupsService } from './groups.service';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Group'))
  @ResponseMessage('OK')
  list(@Query() query: GroupQueryDto, @CurrentCaller() caller: Caller) {
    return this.groups.tree(caller, query.organizationId);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('manage', 'Group'))
  @ResponseMessage('Group created')
  create(@Body() body: CreateGroupDto, @CurrentCaller() caller: Caller) {
    return this.groups.create(body, caller);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('manage', 'Group'))
  @ResponseMessage('Group updated')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateGroupDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.groups.update(id, body, caller);
  }

  @Delete(':id')
  @CheckPolicies((ability) => ability.can('manage', 'Group'))
  @ResponseMessage('Group removed')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.groups.remove(id, caller);
  }
}
