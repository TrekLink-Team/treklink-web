import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SessionUser } from './account-session.service';
import { AuthService, SignInResult } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto, RefreshTokenDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthUser } from './strategies/jwt.strategy';
import { ClientInfo, TokenPair } from './token.service';

const clientInfo = (ip: string | undefined, userAgent: string | undefined): ClientInfo => ({
  ip: ip ?? null,
  userAgent: userAgent ?? null,
});

// Sessions (auth task 6.1, api-design 01 to 04). Login and refresh are public by design: they are
// how a caller obtains a token. Logout and me need a valid access token.
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<SignInResult> {
    return this.auth.login(dto, clientInfo(ip, userAgent));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token refreshed')
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<TokenPair> {
    return this.auth.refresh(dto.refreshToken, clientInfo(ip, userAgent));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Signed out')
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<null> {
    await this.auth.logout(user.id, dto.refreshToken, clientInfo(ip, userAgent));
    return null;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('OK')
  me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.me(user.id);
  }
}
