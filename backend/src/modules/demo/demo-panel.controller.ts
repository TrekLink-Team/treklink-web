import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DemoPanelGuard, PanelRequest } from './demo-panel.guard';
import {
  DemoPanelPlayback,
  PLAYBACK_COMMAND_NAMES,
  PLAYBACK_FLOWS,
  PLAYBACK_MAX_SECONDS,
  PLAYBACK_MIN_SECONDS,
  PlaybackCommandInput,
  PlaybackCommandName,
  PlaybackFlow,
} from './demo-panel-playback';
import { DemoPanelResetService } from './demo-panel-reset.service';
import { DemoPanelService, PanelInput } from './demo-panel.service';

export class DemoPanelActionDto implements PanelInput {
  @IsOptional() @IsUUID() recordId?: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() hardwareVariantId?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
}

export class DemoPanelPlaybackDto implements PlaybackCommandInput {
  @IsIn(PLAYBACK_COMMAND_NAMES) command!: PlaybackCommandName;
  @IsOptional() @IsIn(PLAYBACK_FLOWS) flow?: PlaybackFlow;
  @IsOptional()
  @IsInt()
  @Min(PLAYBACK_MIN_SECONDS)
  @Max(PLAYBACK_MAX_SECONDS)
  intervalSeconds?: number;
}

export class DemoPanelResetDto {
  @IsString() @MaxLength(100) confirmation!: string;
}

const clientOf = (request: PanelRequest) => request.demoPanelClient ?? 'unknown';

// The demo panel routes (specs/demo api-design 13 to 16, D-110). No account and no policy: @Public on the
// class skips the global JWT and policy guards, and DemoPanelGuard on the class requires the panel
// password on every route, reads included (REQ-PNL-02). demo-panel.controller.spec.ts enumerates the
// routes, so a route added without the guard fails it.
@Controller('demo/panel')
@Public()
@UseGuards(DemoPanelGuard)
export class DemoPanelController {
  constructor(
    private readonly panel: DemoPanelService,
    private readonly playback: DemoPanelPlayback,
    private readonly resets: DemoPanelResetService,
  ) {}

  @Get()
  @ResponseMessage('OK')
  async overview() {
    const [panel, reset] = await Promise.all([this.panel.overview(), this.resets.availability()]);
    return { ...panel, playback: this.playback.view(), reset };
  }

  @Post('actions/:action')
  @HttpCode(200)
  @ResponseMessage('Demo panel action completed')
  action(
    @Param('action') action: string,
    @Body() dto: DemoPanelActionDto,
    @Req() request: PanelRequest,
  ) {
    return this.panel.runAction(action, dto, clientOf(request));
  }

  @Post('playback')
  @HttpCode(200)
  @ResponseMessage('Playback updated')
  playbackCommand(@Body() dto: DemoPanelPlaybackDto, @Req() request: PanelRequest) {
    return this.playback.command(dto, clientOf(request));
  }

  @Post('reset')
  @HttpCode(200)
  @ResponseMessage('Demo data reseeded')
  reset(@Body() dto: DemoPanelResetDto, @Req() request: PanelRequest) {
    return this.resets.reset(dto.confirmation, clientOf(request));
  }
}
