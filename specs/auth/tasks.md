# Implementation Tasks: auth

> Rewritten 2026-10-04 (D-036). Ownership from #19 (`07-clarification-answers.md` §8) is kept: LongLP
> owns sessions, KhoaDD owns authorization, LongNN owns TrekLink account administration. Jira keys are
> reassigned when the backlog is regenerated; until then the old keys below are labels only.
>
> Fulfills `design.md`. Starts after platform tasks 2.1, 2.4, 2.5 and 2.8 are merged on `dev`.

## Open branches built on the booking-scope spec

| Branch | What carries over | What changes |
|---|---|---|
| `feat/TK-20-password-reset` (spec only) | The checklist structure; cooldown, attempts and family revocation | Email-only identity (REQ-UBI-01); six-digit `PASSWORD_RESET` code (REQ-EVT-04, REQ-EVT-05); Staff trigger goes to the account's own email (REQ-UBI-09). Rebase onto this suite and redo the checklist against tasks 3.x below |
| `feat/TK-22-admin-manage-user-account` | Last-Admin guard with the advisory lock, list filters, audit emission | Scope narrows to **TrekLink** accounts (`/api/accounts`, api-design 09 to 14); organization accounts are managed by their Manager in `organizations`; invitation is a `SET_PASSWORD` code, not a link token. Rebase and map the checklist onto tasks 5.x below |

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `AuthModule` exporting only `AccountsService`, guards, decorators and the two port tokens (LongLP)
  - _Requirements: design §5_
- [ ] 1.2 Port tokens `ACCOUNT_CONTEXT_PROVIDER`, `API_KEY_RESOLVER` and their interfaces (KhoaDD)
  - _Requirements: design §2, platform design §2.1_
- [ ] 1.3 `MailPort` with `smtp` and `console` transports (LongLP)
  - _Requirements: REQ-OPT-01_

## Phase 2: Sessions (LongLP)

- [ ] 2.1 `PasswordService`: policy from `auth.passwordMinLength`, bcrypt with `BCRYPT_COST`
  - _Requirements: REQ-UBI-02, REQ-ERR-04_
- [ ] 2.2 `AuthService.login`: email lookup, constant-time compare, lockout counters, `AuthEvent` rows
  - _Requirements: REQ-EVT-01, REQ-STA-01, REQ-STA-02, REQ-STA-03, REQ-ERR-01, REQ-UBI-08_
- [ ] 2.3 `TokenService`: access JWT with `organizationId`, `memberRole`, `pv`; refresh families, rotation, reuse detection, sign-out
  - _Requirements: REQ-EVT-01 to REQ-EVT-03, REQ-ERR-02, AC-02_
- [ ] 2.4 `JwtStrategy` re-reading the user and membership per request (cached 30 s, invalidated by `member.deactivated`)
  - _Requirements: REQ-EVT-07, AC-04_

## Phase 3: Codes (LongLP)

- [ ] 3.1 `OneTimeCodeService`: create, hash, attempts, expiry, cooldown
  - _Requirements: REQ-EVT-04, REQ-ERR-03, REQ-ERR-08_
- [ ] 3.2 Forgot, reset and set-password flows; Staff-triggered reset
  - _Requirements: REQ-EVT-04 to REQ-EVT-06, REQ-UBI-09, AC-06_

## Phase 4: Authorization (KhoaDD)

- [ ] 4.1 CASL ability factory from permission rows with `${user.organizationId}` interpolation from the context only; cache keyed by role, invalidated by `policy.changed`
  - _Requirements: REQ-UBI-05, REQ-UBI-06, REQ-EVT-08, AC-03_
- [ ] 4.2 `PoliciesGuard`, `@CheckPolicies`, `scopeWhere(ctx)`, `assertOwnOr404()`
  - _Requirements: REQ-UBI-04, REQ-ERR-06, AC-01_
- [ ] 4.3 `ApiKeyGuard` and `@AuthOneOf('jwt', 'apiKey')`; read-only ability for keys
  - _Requirements: REQ-EVT-09, AC-05_
- [ ] 4.4 Route-enumeration test: every mutating route declares both an auth guard and a policy
  - _Requirements: REQ-UBI-04_

## Phase 5: TrekLink account administration (LongNN)

- [ ] 5.1 `AccountsService` list, create with invitation, edit, deactivate, reactivate; last-Admin guard under an advisory lock
  - _Requirements: REQ-EVT-06, REQ-EVT-07, REQ-ERR-05, REQ-ERR-07_
- [ ] 5.2 `AccountsService.createOrganizationAccount`, `setOrganizationRole`, `deactivate`, `contactCard` for other modules
  - _Requirements: design §5_
- [ ] 5.3 Roles: list, replace permissions with the `ADMIN_LOCKOUT` guard
  - _Requirements: REQ-EVT-08_

## Phase 6: API Presentation Layer

- [ ] 6.1 Controllers for api-design 01 to 17, each with `@ResponseMessage` from the spec
- [ ] 6.2 E2E: every Validation row; `backend/test/tenancy.e2e-spec.ts` created with the auth cases
  - _Requirements: AC-01 to AC-06_

## Phase 7: Frontend Integration

- [ ] 7.1 Sign-in, forgot and reset, set-password pages; token refresh in `apiClient` (tracked in `specs/frontend/tasks.md`)

## Phase 8: Verification & DoD

- [ ] 8.1 Suite green; lint, boundary check, typecheck clean
- [ ] 8.2 `api-design/*.md` regenerated and matching behaviour; Permission Matrix regenerated
