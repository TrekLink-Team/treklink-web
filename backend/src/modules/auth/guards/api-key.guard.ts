import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { Request } from 'express';
import { DomainException, ErrorCode } from '../../../common/errors';
import { AbilityFactory, AppAbility } from '../casl/ability.factory';
import { API_KEY_RESOLVER, ApiKeyResolver } from '../ports/api-key-resolver.port';
import { AuthUser } from '../strategies/jwt.strategy';
import { hashApiKey } from '../token.service';

export const API_KEY_HEADER = 'x-api-key';

// The fixed read-only permissions of every organization API key (specs/auth/design.md §2, BR-20).
export const API_KEY_PERMISSIONS = [
  'liveMap.read.own',
  'telemetryHistory.read.own',
  'incident.read.own',
] as const;

// The caller of a request authenticated by an organization API key. It has no account and no role;
// `accountType` and `organization` make `scopeWhere` scope it like a member of that organization.
export interface ApiKeyCaller {
  kind: 'API_KEY';
  apiKeyId: string;
  accountType: typeof AccountType.ORGANIZATION;
  organization: { id: string };
  roles: readonly string[];
  ability: AppAbility;
}

// Whoever a request was authenticated as: an account (JWT) or an organization API key.
export type RequestPrincipal = AuthUser | ApiKeyCaller;

const unauthenticated = () =>
  new DomainException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    'Authentication required.',
  );

// Authenticates `X-Api-Key` (auth task 4.3, REQ-EVT-09): hashes the key, resolves it through the
// API_KEY_RESOLVER port that `organizations` provides, and sets the caller to that organization with
// the fixed read-only ability. Unknown, revoked or malformed keys are 401 without saying which. Until
// `organizations` provides the port, every key is refused, so the guard fails closed. The resolver
// updates `lastUsedAt` at most once a minute (port contract). JwtAuthGuard hands a request to this
// guard when it carries a key and no bearer token; PoliciesGuard then limits it to read routes marked
// `@AuthOneOf(..., 'apiKey')`.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly abilities: AbilityFactory,
    @Optional()
    @Inject(API_KEY_RESOLVER)
    private readonly resolver?: ApiKeyResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestPrincipal }>();
    request.user = await this.authenticate(request.headers[API_KEY_HEADER]);
    return true;
  }

  async authenticate(key: unknown): Promise<ApiKeyCaller> {
    if (typeof key !== 'string' || key === '' || !this.resolver) throw unauthenticated();
    const resolved = await this.resolver.resolve(hashApiKey(key));
    if (!resolved) throw unauthenticated();
    return {
      kind: 'API_KEY',
      apiKeyId: resolved.apiKeyId,
      accountType: AccountType.ORGANIZATION,
      organization: { id: resolved.organizationId },
      roles: [],
      ability: await this.abilities.forApiKey(resolved.organizationId, API_KEY_PERMISSIONS),
    };
  }
}
