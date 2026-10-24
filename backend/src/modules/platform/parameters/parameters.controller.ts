import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { PagedQueryDto } from '../../../common/dto/paging';
import { Caller, CheckPolicies, CurrentCaller } from '../../../common/decorators/access.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { ParameterListQueryDto } from './parameter-query.dto';
import { ParameterReadsService } from './parameter-reads.service';
import { ParameterUpdateDto } from './parameter-update.dto';
import { ParameterService } from './parameter.service';

// Business parameters (task 4.2, api-design 02 to 04, UC-57). TrekLink Admin only: `parameter.manage`.
// Token and policy are checked by the global guards (D-061).
@Controller('parameters')
@CheckPolicies((ability) => ability.can('manage', 'Parameter'))
export class ParametersController {
  constructor(
    private readonly reads: ParameterReadsService,
    private readonly parameters: ParameterService,
  ) {}

  @Get()
  @ResponseMessage('OK')
  list(@Query() query: ParameterListQueryDto) {
    return this.reads.list(query);
  }

  @Patch(':key')
  @ResponseMessage('Parameter updated')
  update(
    @Param('key') key: string,
    @Body() dto: ParameterUpdateDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.parameters.update(
      key,
      { value: dto.value, expectedVersion: dto.expectedVersion, reason: dto.reason ?? null },
      { id: caller.id, roles: caller.roles },
    );
  }

  @Get(':key/history')
  @ResponseMessage('OK')
  history(@Param('key') key: string, @Query() query: PagedQueryDto) {
    return this.reads.history(key, query);
  }
}
