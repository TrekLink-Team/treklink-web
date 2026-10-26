import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { isPublic } from '../../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { AuthUser } from '../strategies/jwt.strategy';
import { API_KEY_HEADER, ApiKeyGuard } from './api-key.guard';

// Requires a valid access token on every route that is not @Public (global since D-061). A missing,
// malformed or expired token, or an account that may no longer hold a session, is 401
// UNAUTHENTICATED in the standard envelope (FR-AUTH-01). A request with an `X-Api-Key` and no
// bearer token is authenticated by ApiKeyGuard instead; a bearer token wins when both are sent.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyGuard,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (isPublic(this.reflector, context)) return true;
    const headers = context.switchToHttp().getRequest<Request>().headers;
    if (headers.authorization === undefined && headers[API_KEY_HEADER] !== undefined) {
      return this.apiKeys.canActivate(context);
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthUser>(error: unknown, user: TUser | false): TUser {
    if (error instanceof DomainException) throw error;
    if (error || !user) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }
    return user;
  }
}
