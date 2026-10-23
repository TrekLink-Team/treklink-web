import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DomainException, ErrorCode } from '../../../common/errors';
import { AuthUser } from '../strategies/jwt.strategy';

// Requires a valid access token. A missing, malformed or expired token, or an account that may no
// longer hold a session, is 401 UNAUTHENTICATED in the standard envelope (FR-AUTH-01).
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
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
