import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  FieldSimulationService,
  MAX_SPEED_METRES_PER_MINUTE,
  MIN_SPEED_METRES_PER_MINUTE,
  SIMULATION_PATTERNS,
  SIMULATION_STYLES,
  type SimulationEventKind,
  type SimulationPatternName,
  type SimulationStyleName,
} from '../gateway-sync';
import { DemoSimulationGuard } from './demo-simulation.guard';

export const SIMULATION_EVENT_KINDS: readonly SimulationEventKind[] = ['SOS', 'FALL', 'SOS_CANCEL'];

export class StartSimulatedNodeDto {
  @IsUUID()
  deviceId!: string;

  @IsString()
  @MaxLength(64)
  trailId!: string;

  @IsIn(SIMULATION_PATTERNS)
  pattern!: SimulationPatternName;

  @IsOptional()
  @IsIn(SIMULATION_STYLES)
  style?: SimulationStyleName;

  @IsOptional()
  @IsInt()
  @Min(MIN_SPEED_METRES_PER_MINUTE)
  @Max(MAX_SPEED_METRES_PER_MINUTE)
  speedMetresPerMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  startMetres?: number;
}

export class UpdateSimulatedNodeDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsIn(SIMULATION_PATTERNS)
  pattern?: SimulationPatternName;

  @IsOptional()
  @IsIn(SIMULATION_STYLES)
  style?: SimulationStyleName;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  trailId?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_SPEED_METRES_PER_MINUTE)
  @Max(MAX_SPEED_METRES_PER_MINUTE)
  speedMetresPerMinute?: number;
}

export class StopSimulatedNodeDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class SimulationEventDto {
  @IsIn(SIMULATION_EVENT_KINDS)
  kind!: SimulationEventKind;
}

const actorOf = (caller: Caller) => ({ id: caller.id, roles: caller.roles });

// The field simulation of the demo panel (specs/demo api-design 06 to 10, D-093 amendment, D-094). Loaded
// only when DEMO_SIMULATION_ENABLED is true (DemoSimulationModule); every route needs `demo.simulate`
// (TrekLink Admin) and every write passes the database check first. The logic is FieldSimulationService
// of gateway-sync, which also writes the audit entry of each command.
@Controller('demo/simulation')
export class DemoSimulationController {
  constructor(
    private readonly simulation: FieldSimulationService,
    private readonly guard: DemoSimulationGuard,
  ) {}

  @Get()
  @CheckPolicies((ability) => ability.can('simulate', 'Demo'))
  @ResponseMessage('OK')
  async overview() {
    return { databaseAllowed: this.guard.databaseAllowed(), ...(await this.simulation.overview()) };
  }

  @Post('nodes')
  @CheckPolicies((ability) => ability.can('simulate', 'Demo'))
  @ResponseMessage('Simulated node started')
  start(@Body() dto: StartSimulatedNodeDto, @CurrentCaller() caller: Caller) {
    this.guard.assertAllowed(caller);
    return this.simulation.start(dto, actorOf(caller));
  }

  @Patch('nodes/:id')
  @CheckPolicies((ability) => ability.can('simulate', 'Demo'))
  @ResponseMessage('Simulated node changed')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSimulatedNodeDto,
    @CurrentCaller() caller: Caller,
  ) {
    this.guard.assertAllowed(caller);
    return this.simulation.update(id, dto, actorOf(caller));
  }

  @Post('nodes/:id/stop')
  @HttpCode(200)
  @CheckPolicies((ability) => ability.can('simulate', 'Demo'))
  @ResponseMessage('Simulated node stopped')
  stop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StopSimulatedNodeDto,
    @CurrentCaller() caller: Caller,
  ) {
    this.guard.assertAllowed(caller);
    return this.simulation.stop(id, dto.expectedVersion, actorOf(caller));
  }

  @Post('nodes/:id/events')
  @HttpCode(200)
  @CheckPolicies((ability) => ability.can('simulate', 'Demo'))
  @ResponseMessage('Simulated event raised')
  raise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulationEventDto,
    @CurrentCaller() caller: Caller,
  ) {
    this.guard.assertAllowed(caller);
    return this.simulation.raise(id, dto.kind, actorOf(caller));
  }
}
