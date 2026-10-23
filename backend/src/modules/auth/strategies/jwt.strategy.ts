import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DomainException, ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { AccountSessionService, SessionUser } from '../account-session.service';
import { AbilityFactory, AppAbility } from '../casl/ability.factory';
import { AccessTokenPayload } from '../token.service';

// The authenticated caller of a JWT request, with the CASL ability of its roles (task 4.1).
export type AuthUser = SessionUser & { kind: 'USER'; ability: AppAbility };

// Verifies the access token, then rebuilds the context from the database on every request: an
// inactive or deleted account, or a member who lost their membership, fails the next request with
// 401 instead of waiting for the token to expire (auth task 2.4, REQ-EVT-07). The roles and
// organization of the ability come from the database row, never from the token or the request.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly sessions: AccountSessionService,
    private readonly abilities: AbilityFactory,
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
    const ability = await this.abilities.forContext({
      userId: user.id,
      organizationId: user.organization?.id ?? null,
      roles: user.roles,
    });
    return { ...user, kind: 'USER', ability };
  }
}
