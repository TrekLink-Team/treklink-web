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
import { CreateShiftDto, RosterQueryDto, UpdateShiftDto } from './dto/roster.dto';
import { RosterWarning, ShiftsService, ShiftView } from './shifts.service';

// The on-duty roster (api-design 16 to 19). A Manager or an Operator reads it (`roster.read.own`), a
// Manager changes it (`roster.manage.own`); the service answers 404 for another organization.
@Controller('organizations/:id/roster')
export class RosterController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'RosterShift'))
  @ResponseMessage('OK')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RosterQueryDto,
    @CurrentCaller() caller: Caller,
  ): Promise<{ shifts: ShiftView[]; warnings: RosterWarning[] }> {
    return this.shifts.list(id, new Date(query.from), new Date(query.to), caller);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('manage', 'RosterShift'))
  @ResponseMessage('Saved.')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateShiftDto,
    @CurrentCaller() caller: Caller,
  ): Promise<{ shift: ShiftView; warnings: RosterWarning[] }> {
    return this.shifts.create(
      id,
      {
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        primaryMemberId: dto.primaryMemberId,
        backupMemberId: dto.backupMemberId,
      },
      caller,
    );
  }

  @Patch(':shiftId')
  @CheckPolicies((ability) => ability.can('manage', 'RosterShift'))
  @ResponseMessage('Saved.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() dto: UpdateShiftDto,
    @CurrentCaller() caller: Caller,
  ): Promise<{ shift: ShiftView; warnings: RosterWarning[] }> {
    return this.shifts.update(
      id,
      shiftId,
      {
        startsAt: dto.startsAt === undefined ? undefined : new Date(dto.startsAt),
        endsAt: dto.endsAt === undefined ? undefined : new Date(dto.endsAt),
        primaryMemberId: dto.primaryMemberId,
        backupMemberId: dto.backupMemberId,
      },
      caller,
    );
  }

  @Delete(':shiftId')
  @CheckPolicies((ability) => ability.can('manage', 'RosterShift'))
  @ResponseMessage('Shift deleted')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @CurrentCaller() caller: Caller,
  ): Promise<null> {
    await this.shifts.remove(id, shiftId, caller);
    return null;
  }
}
