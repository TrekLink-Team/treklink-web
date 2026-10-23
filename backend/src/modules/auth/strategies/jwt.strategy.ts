import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DomainException, ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { AccountSessionService, SessionUser } from '../account-session.service';
import { AccessTokenPayload } from '../token.service';

// The authenticated caller of a JWT request. Task 4.1 adds the CASL ability.
export type AuthUser = SessionUser & { kind: 'USER' };

// Verifies the access token, then rebuilds the context from the database on every request: an
// inactive or deleted account, or a member who lost their membership, fails the next request with
// 401 instead of waiting for the token to expire (auth task 2.4, REQ-EVT-07).
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly sessions: AccountSessionService,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    const user = await this.sessions.load(payload.sub);
    if (!user) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }
    return { ...user, kind: 'USER' };
  }
}
