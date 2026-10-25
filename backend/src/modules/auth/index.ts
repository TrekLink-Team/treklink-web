// Public surface of `auth` (task 1.1). Other modules import only from here. `AccountsService`,
// `ApiKeyGuard` and `@AuthOneOf` join this list with tasks 4.3 and 5.1.
export { AuthModule } from './auth.module';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { PoliciesGuard } from './guards/policies.guard';
export { CheckPolicies, type PolicyHandler } from './decorators/check-policies.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
export { AbilityFactory, type AbilityContext, type AppAbility } from './casl/ability.factory';
export { POLICY_CHANGED } from './casl/permission-cache';
export { assertOwnOr404, scopeWhere } from './scoping';
export type { AuthUser } from './strategies/jwt.strategy';
export {
  MEMBER_DEACTIVATED,
  type MemberDeactivatedEvent,
  type SessionUser,
} from './account-session.service';
export { AccessTokenAuthenticator } from './access-token-authenticator.service';
export { MAIL_PORT, type MailMessage, type MailPort } from './mail/mail.port';
export {
  ACCOUNT_CONTEXT_PROVIDER,
  type AccountContextProvider,
  type AccountMembership,
  type MemberRole,
} from './ports/account-context.port';
export {
  API_KEY_RESOLVER,
  type ApiKeyResolver,
  type ResolvedApiKey,
} from './ports/api-key-resolver.port';
