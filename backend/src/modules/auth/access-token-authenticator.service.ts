import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountSessionService, SessionUser } from './account-session.service';
import { AccessTokenPayload } from './token.service';

// Turns an access token into the signed-in account outside an HTTP request, for the `/live` socket
// handshake of `monitoring` (specs/monitoring/api-design/ws-live-contract.md). Same rules as
// JwtStrategy: a valid signature and expiry, then the account rebuilt from the database, so a
// deactivated account or a lost membership fails the handshake. Any failure is null, so the caller
// answers UNAUTHENTICATED without learning why. `expiresAt` lets a long-lived socket end with its token.
export interface AuthenticatedSession {
  user: SessionUser;
  // When the access token expires, in epoch milliseconds.
  expiresAt: number;
}

@Injectable()
export class AccessTokenAuthenticator {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: AccountSessionService,
  ) {}

  async authenticate(token: unknown): Promise<AuthenticatedSession | null> {
    if (typeof token !== 'string' || token === '') return null;
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload & { exp: number }>(token, {
        algorithms: ['HS256'],
      });
      const user = await this.sessions.load(payload.sub);
      return user ? { user, expiresAt: payload.exp * 1000 } : null;
    } catch {
      return null;
    }
  }
}
