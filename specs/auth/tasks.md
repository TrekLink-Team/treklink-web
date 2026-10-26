# Implementation Tasks: auth

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6. Fulfills `design.md`;
> endpoints are `api-design/01` to `17`; permissions are the generated [Permission Matrix](permission-matrix.md).

| | |
|---|---|
| Lane owner | LongLP (roadmap §5.1); authorization (Phase 4) reviewed by KhoaDD |
| Reviewer | KhoaDD |
| Sprint | 3 (W7 to W8) |
| Stories | US-UC08, US-UC09, US-UC10 (US-UC04 member accounts are created through `organizations`) |
| Depends on | platform 2.2 to 2.8 merged on `dev` |

## Open branches built on the booking-scope spec

| Branch | Carries over | Changes |
|---|---|---|
| `feat/TK-20-password-reset` (spec only) | Checklist shape; cooldown, attempts, family revocation | Email-only identity (REQ-UBI-01); six-digit `PASSWORD_RESET` code; Staff trigger to the account's own email (REQ-UBI-09). Redo against tasks 3.1 and 3.2 |
| `feat/TK-22-admin-manage-user-account` | Last-Admin guard with the advisory lock, list filters, audit emission | Scope is **TrekLink** accounts only (api-design 09 to 14); invitation is a `SET_PASSWORD` code. Map onto tasks 5.1 to 5.3 |

## Phase 1: Foundation & Domain Modeling

- [x] 1.1 `AuthModule` and its public surface (owner LongLP)
  - **Files**: `backend/src/modules/auth/auth.module.ts`, `index.ts`
  - **Do**: export only `AccountsService`, `JwtAuthGuard`, `ApiKeyGuard`, `PoliciesGuard`, `@CheckPolicies`, `@AuthOneOf`, `@CurrentUser`, `scopeWhere`, `assertOwnOr404` and the two port tokens; import `PlatformModule`, `JwtModule.registerAsync` with `JWT_ACCESS_SECRET` and `JWT_ACCESS_TTL`
  - _Requirements: design §5_
- [x] 1.2 Port tokens and interfaces (owner LongLP)
  - **Files**: `backend/src/modules/auth/ports/account-context.port.ts`, `api-key-resolver.port.ts`
  - **Do**: `ACCOUNT_CONTEXT_PROVIDER` with `forUser(userId)` and `API_KEY_RESOLVER` with `resolve(keyHash)`, exactly as design §2; `organizations` 1.3 provides both
  - _Requirements: design §2, platform design §2.1_
- [x] 1.3 `MailPort` with `smtp` and `console` transports (owner LongLP)
  - **Files**: `backend/src/modules/auth/mail/mail.port.ts`, `smtp.transport.ts`, `console.transport.ts`
  - **Do**: `send({ to, subject, text })`; `MAIL_TRANSPORT=console` writes the email to the server log, for local development and CI only, and the backend refuses to start with it in production; `MAIL_TRANSPORT=smtp` sends through `SMTP_URL` with `nodemailer` (D-063 rules 3 and 4). Other modules (incidents email channel) reuse it
  - **Test**: console transport logs one line per mail; console under `NODE_ENV=production` and smtp without `SMTP_URL` stop the boot
  - _Requirements: REQ-OPT-01_
- [x] 1.4 `AccountsRepository` over `User`, `Role`, `UserRole`, `RefreshToken`, `OneTimeCode`, `AuthEvent` (owner LongLP)
  - **Do**: email stored lower-case; uniqueness checked case-insensitively including soft-deleted rows; `accountType` and role compatibility enforced (`TREKLINK` holds `ADMIN` or `STAFF`, `ORGANIZATION` holds `ORG_MANAGER` or `ORG_OPERATOR`); reads exclude `deletedAt` rows except audit lookups
  - **Test**: mixed-case duplicate email rejected 409 `CONFLICT_UNIQUE`; a `TREKLINK` account given `ORG_MANAGER` rejected
  - _Requirements: REQ-UBI-01, REQ-UBI-03, REQ-UBI-07, REQ-ERR-05, FR-AUTH-09_

## Phase 2: Sessions

- [x] 2.1 `PasswordService` (owner LongLP)
  - **Files**: `backend/src/modules/auth/password.service.ts`
  - **Do**: `assertPolicy(pw)` against `auth.passwordMinLength` (400 `PASSWORD_POLICY`); `hash()` with `BCRYPT_COST`; `verify()` constant-time, and a dummy compare when the user is unknown
  - **Test**: policy boundary at the minimum length; a hash never equals its input
  - _Requirements: REQ-UBI-02, REQ-ERR-04_
- [x] 2.2 `AuthService.login(dto, ip, userAgent)` (owner LongLP)
  - **Files**: `backend/src/modules/auth/auth.service.ts`
  - **Do**: find by lower-cased email; refuse inactive, deleted or password-less accounts; refuse members of `CLOSED` or `REJECTED` organizations via `ACCOUNT_CONTEXT_PROVIDER`; lockout after `auth.loginMaxFailures` in `auth.loginFailureWindowMinutes` for `auth.lockoutMinutes` (423 `ACCOUNT_LOCKED`); one message for unknown email and wrong password (401 `INVALID_CREDENTIALS`, MSG09); write `AuthEvent` for success and failure without the attempted password
  - **Test**: `auth.service.spec.ts`: success; wrong password; unknown email returns the same body; lockout at the threshold and release after the window; `CLOSED` organization refused, `SUSPENDED` allowed
  - _Requirements: REQ-EVT-01, REQ-STA-01, REQ-STA-02, REQ-STA-03, REQ-ERR-01, REQ-UBI-08, FR-AUTH-02, FR-AUTH-08_
  - _Story: US-UC08_
- [x] 2.3 `TokenService` (owner LongLP)
  - **Files**: `backend/src/modules/auth/token.service.ts`
  - **Do**: access JWT `{ sub, accountType, roles, organizationId?, memberRole?, pv }`; refresh token 32 random bytes, stored as SHA-256, new `familyId` per sign-in, `replacedById` chain on rotation; `refresh()` re-reads roles and membership; a reused token revokes the family, writes `TOKEN_REUSE_DETECTED`, returns 401 `REFRESH_REUSED`; `logout()` revokes the presented token
  - **Test**: rotation chain; reuse revokes every token in the family; logout then refresh gets 401 `REFRESH_INVALID`
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-EVT-03, REQ-ERR-02, AC-02, FR-AUTH-03, FR-AUTH-04_
  - _Story: US-UC08_
- [x] 2.4 `JwtStrategy` and `JwtAuthGuard` (owner LongLP)
  - **Files**: `backend/src/modules/auth/strategies/jwt.strategy.ts`, `guards/jwt-auth.guard.ts`
  - **Do**: per request rebuild the context: user active and not deleted, permissions from the CASL cache, membership from `ACCOUNT_CONTEXT_PROVIDER` cached 30 s and invalidated by `member.deactivated`; a deactivated account fails the next request with 401
  - **Test**: AC-04 in e2e 6.2
  - _Requirements: REQ-EVT-07, AC-04, FR-AUTH-07_

## Phase 3: Codes

- [x] 3.1 `OneTimeCodeService` (owner LongLP)
  - **Files**: `backend/src/modules/auth/one-time-code.service.ts`
  - **Do**: six-digit code, SHA-256 stored, purpose `SET_PASSWORD` or `PASSWORD_RESET`, expiry from `auth.resetCodeTtlMinutes` or `auth.invitationTtlHours`, attempts up to `auth.codeMaxAttempts`, resend cooldown `auth.codeResendCooldownSeconds` (429 `OTP_COOLDOWN`); a wrong, expired, consumed or exhausted code is 400 `CODE_INVALID` (MSG08)
  - **Test**: each failure branch increments attempts; cooldown boundary
  - _Requirements: REQ-EVT-04, REQ-ERR-03, REQ-ERR-08_
- [x] 3.2 Forgot, reset, set-password and change-password flows (owner LongLP)
  - **Files**: `auth.service.ts`, `password-flows.service.ts`
  - **Do**: forgot answers identically for unknown emails and sends a `SET_PASSWORD` code to an active account with no password (D-059 rule 6); reset sets the hash, consumes the code and revokes every refresh token; set-password (invitation) sets the first password and signs in; change-password checks the current one; Staff-triggered reset (api-design 14) emails the account's own address and returns no code
  - **Test**: AC-06: no response body or log line contains a password or a code
  - _Requirements: REQ-EVT-04, REQ-EVT-05, REQ-EVT-06, REQ-UBI-09, AC-06, FR-AUTH-05, BR-35_
  - _Story: US-UC09_

## Phase 4: Authorization (reviewed by KhoaDD)

- [x] 4.1 CASL ability factory (owner LongLP)
  - **Files**: `backend/src/modules/auth/casl/ability.factory.ts`, `permission-cache.ts`
  - **Do**: build from permission rows; `ADMIN` inherits `STAFF`, `ORG_MANAGER` inherits `ORG_OPERATOR`; interpolate `${user.organizationId}` from the request context only; cache by role, invalidated by `policy.changed`
  - **Test**: a request body carrying `organizationId` cannot change the interpolated value; AC-03 permission removal applies on the next request
  - _Requirements: REQ-UBI-05, REQ-UBI-06, REQ-EVT-08, AC-03, FR-AUTH-06, FR-AUTH-10, FR-AUTH-11_
- [x] 4.2 `PoliciesGuard`, `@CheckPolicies`, `scopeWhere(ctx)`, `assertOwnOr404()` (owner LongLP)
  - **Files**: `guards/policies.guard.ts`, `decorators/check-policies.decorator.ts`, `scoping.ts`
  - **Do**: missing permission 403 `FORBIDDEN`; record of another organization 404 `NOT_FOUND` (scoped 404 rule); `scopeWhere` returns `{}` for TrekLink accounts and `{ organizationId }` otherwise
  - **Test**: AC-01 seeds `backend/test/tenancy.e2e-spec.ts`
  - _Requirements: REQ-UBI-04, REQ-ERR-06, AC-01, FR-AUTH-01, BR-19, BR-20_
- [x] 4.3 `ApiKeyGuard` and `@AuthOneOf('jwt', 'apiKey')` (owner LongLP)
  - **Files**: `guards/api-key.guard.ts`, `decorators/auth-one-of.decorator.ts`
  - **Do**: hash `X-Api-Key`, resolve through `API_KEY_RESOLVER`, context `{ kind: 'API_KEY', organizationId }` with the fixed read-only ability `liveMap.read.own`, `telemetryHistory.read.own`, `incident.read.own`; an API key on a mutating route is 403
  - **Test**: AC-05
  - _Requirements: REQ-EVT-09, AC-05_
  - **Done**: the global `JwtAuthGuard` hands a request with `X-Api-Key` and no bearer token to `ApiKeyGuard` (a bearer token wins when both are sent); the caller is `{ kind: 'API_KEY', apiKeyId, accountType: ORGANIZATION, organization: { id }, roles: [] }`, so `scopeWhere` scopes it as a member. The ability is the three permission rows read by key (`AbilityFactory.forApiKey`), bound to the key's organization. `PoliciesGuard` refuses a key with 403 everywhere except a GET or HEAD route marked `@AuthOneOf(..., 'apiKey')`; `@CurrentCaller()` refuses a key with 403, because a key acts as no account; `@CurrentPrincipal()` reads either caller. With no `API_KEY_RESOLVER` provider (until `organizations` 1.3) every key is 401. AC-05 runs on a test-only controller, because the organization API routes are not built yet
- [x] 4.4 Route-enumeration test (owner LongLP)
  - **Files**: `backend/test/route-guards.e2e-spec.ts`
  - **Do**: walk Nest's router; every POST, PUT, PATCH and DELETE route except the routes marked Public or secret-authenticated in their api-design file (login, refresh, forgot, reset, set-password, organization registration, the SePay webhook, the MQTT hooks) declares an auth guard and a policy
  - _Requirements: REQ-UBI-04_
  - **Done**: the test walks every controller through Nest's discovery service. A mutating route needs `@CheckPolicies` unless it is on the public list or the token-only list of D-061 rule 2 (logout, `me`, password change); a `@Public` route off the public list fails, as does any route with no guard marking or a mutating route marked for API keys. A module adding a public or token-only route adds it to the list in the same PR

## Phase 5: TrekLink account administration

- [x] 5.1 `AccountsService` for TrekLink accounts (owner LongLP)
  - **Files**: `backend/src/modules/auth/accounts.service.ts`
  - **Do**: list with filters (role, active, search by email or name), create without password and send `SET_PASSWORD`, edit name and roles, deactivate (revoke refresh tokens, emit `audit.record`), reactivate; there is no hard-delete path (soft delete only); last-Admin and self-demotion guards under `pg_advisory_xact_lock` (409 `LAST_ADMIN`, `SELF_DEMOTION`)
  - **Test**: removing the last active Admin by deactivation and by role change both refused; concurrent attempts do not both pass
  - _Requirements: REQ-EVT-06, REQ-EVT-07, REQ-ERR-05, REQ-ERR-07, FR-AUTH-07, FR-AUTH-09_
  - _Story: US-UC10_
- [ ] 5.2 Services for other modules (owner LongLP)
  - **Do**: `createOrganizationAccount(input, tx)` (sends the invitation after commit), `setOrganizationRole(userId, role, tx)`, `deactivate(userId, reason, actor, tx)`, `contactCard(userIds)`, as design §5
  - **Test**: invitation not sent when the caller's transaction rolls back
  - _Requirements: design §5, FR-ORG-02_
  - _Story: US-UC04_
- [x] 5.3 Roles: list and replace permissions, permission catalog (owner LongLP)
  - **Do**: `GET /api/roles` returns permission keys only; `GET /api/permissions` (api-design 18) serves the seeded catalog with `scope`, `accountType` and `protected`, never `conditions`, `fields` or `inverted`; replace: unknown permission 400 `UNKNOWN_PERMISSION`; a permission of the other account type 400 `PERMISSION_SCOPE_MISMATCH`; a change that leaves no role able to manage roles 409 `ADMIN_LOCKOUT`; emit `policy.changed` (D-057 rule 2)
  - **Test**: `organization.decide` sent for `ORG_MANAGER` gets 400 `PERMISSION_SCOPE_MISMATCH` and the role is unchanged; the catalog lists a permission that no role holds
  - _Requirements: REQ-EVT-08, REQ-ERR-09_
  - _Story: US-UC10_

## Phase 6: API Presentation Layer

- [ ] 6.1 `AuthController`, `AccountsController`, `RolesController`, `AuthEventsController` (owner LongLP)
  - **Do**: api-design 01 to 18 with the routes, permissions and `@ResponseMessage` of each file; the refresh token travels in the request body (api-design 02), and `apiClient` refreshes once on 401 (frontend design)
  - _Requirements: FR-AUTH-01 to FR-AUTH-08_
  - **Done**: `AuthController` with api-design 01 to 04 (login, refresh, logout, me), in treklink-web#48, and 05 to 08 (forgot, reset, set, change password); `AccountsController` with api-design 14 (Staff-triggered reset), for US-UC09; api-design 09 to 13, `RolesController` (15, 16) and `PermissionsController` (18), for US-UC10. `AuthEventsController` (17) is open
- [ ] 6.2 E2E (owner LongLP)
  - **Files**: `backend/test/auth.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts` (created here)
  - **Do**: every Validation row of api-design 01 to 18; AC-01 to AC-06
  - _Requirements: AC-01 to AC-06_

## Phase 7: Frontend Integration

- [ ] 7.1 Sign-in, forgot, reset, set-password pages; silent refresh in `apiClient`; TrekLink accounts page (owner LongNN, tracked in `specs/frontend/tasks.md` 2.1 to 2.3 and 7.1)

## Phase 8: Verification & DoD

- [ ] 8.1 Suite green; lint, boundary check, typecheck clean (owner LongLP)
- [ ] 8.2 `api-design/*.md` and the Permission Matrix regenerated and matching behaviour (owner LongLP)
