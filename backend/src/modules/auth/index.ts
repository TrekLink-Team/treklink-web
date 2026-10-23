// Public surface of `auth` (task 1.1). Other modules import only from here. `AccountsService`,
// `ApiKeyGuard`, `PoliciesGuard`, `@CheckPolicies`, `@AuthOneOf`, `scopeWhere` and
// `assertOwnOr404` join this list with tasks 4.1 to 4.3 and 5.1.
export { AuthModule } from './auth.module';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { CurrentUser } from './decorators/current-user.decorator';
export type { AuthUser } from './strategies/jwt.strategy';
export { MEMBER_DEACTIVATED, type MemberDeactivatedEvent } from './account-session.service';
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
