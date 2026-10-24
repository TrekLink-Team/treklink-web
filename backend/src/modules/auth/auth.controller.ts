import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { Authenticated, Public } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SessionUser } from './account-session.service';
import { AuthService, SignInResult } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SetPasswordDto,
} from './dto/auth.dto';
import { PasswordFlowsService } from './password-flows.service';
import { AuthUser } from './strategies/jwt.strategy';
import { ClientInfo, TokenPair } from './token.service';

export const clientInfo = (ip: string | undefined, userAgent: string | undefined): ClientInfo => ({
  ip: ip ?? null,
  userAgent: userAgent ?? null,
});

// Sessions and passwords (auth task 6.1, api-design 01 to 08). Login, refresh and the code flows are
// public by design: they are how a caller obtains a token. Logout, me and change password need a
// valid access token and no permission (D-061).
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordFlowsService,
  ) {}

  @Post('login')
  @Public()
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
  @Public()
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
  @Authenticated()
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
  @Authenticated()
  @ResponseMessage('OK')
  me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.me(user.id);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('If the email is registered, a code has been sent.')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<null> {
    await this.passwords.forgot(dto.email, clientInfo(ip, userAgent));
    return null;
  }

  @Post('password/reset')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password changed')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<null> {
    await this.passwords.reset(
      { email: dto.email, code: dto.code, password: dto.newPassword },
      clientInfo(ip, userAgent),
    );
    return null;
  }

  @Post('password/set')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Welcome to TrekLink')
  setPassword(
    @Body() dto: SetPasswordDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<SignInResult> {
    return this.passwords.setPassword(dto, clientInfo(ip, userAgent));
  }

  @Post('password/change')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password changed')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<null> {
    await this.passwords.change(user.id, dto, clientInfo(ip, userAgent));
    return null;
  }
}
