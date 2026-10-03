# Implementation Tasks: auth

> Approved by: KhoaDD. The TK-22 checklist was approved and merged in #14 on 2026-09-30. The shared auth foundation section, its ownership and the dependency order were decided in #19 on 2026-09-30 (`treklink-docs` `07-clarification-answers.md` §8).
> Jira: shared foundation `TK-15`, `TK-16`, `TK-18`, `TK-19`, `TK-21` | TK-22 checklist `TK-22` (`US-009`), branch `feat/TK-22-admin-manage-user-account` | TK-20 checklist `TK-20` (`US-007`), branch `feat/TK-20-password-reset`, awaiting approval
>
> Fulfills `design.md`. No auth code starts before platform tasks 2.1 (the rest), 2.4 and 2.5 are merged on `dev` (`specs/platform/tasks.md` Phase 2).

## Shared auth foundation (module-wide)

Restored from the task list before #14 (`e0094a3~1`), for the shared pieces only (§8 questions 3, 4, 7 and 8). Story-level work such as the registration flow, password reset, account and role administration, controllers and e2e stays with the owning story's own checklist. Task ids carry an `F` prefix so they do not collide with the TK-22 checklist below. Requirement ids are the current ones; where #14 renumbered a requirement, the restored task cites the requirement that now carries the behaviour.

### Prerequisites and dependency order

- **Platform prerequisite** (LongLP): the rest of task 2.1, 2.4 `ParameterService` and 2.5 the `audit.record` sink, merged on `dev` before TK-16 starts. Tasks 2.2 and 2.3 may land in parallel with TK-16.
- **Order**: platform prerequisite, then TK-16, then TK-18 and TK-21 in parallel, then TK-19, then TK-15, then TK-22 and TK-17.

### Ownership

| Story | Owner | Builds |
|---|---|---|
| TK-16 (US-003) | LongLP | `AuthModule`, `PasswordService`, `TokenService` (access tokens), login with lockout, `JwtStrategy`, `JwtAuthGuard`, `@CurrentUser()`, `User.tokenVersion` with the `ver` check, and the auth `audit.record` emission |
| TK-18 (US-005) | LongLP, secondary KhoaDD | Refresh-token persistence, rotation, reuse detection and family revocation |
| TK-19 (US-006) | LongLP | Per-account revocation on top of TK-18 |
| TK-21 (US-008) | KhoaDD | CASL ability construction, `PoliciesGuard`, `SCOPE_PROVIDER`, `assertInScopeOr404()` and the route-enumeration test |
| TK-15 (US-002) | LongLP | `OtpService` and `MailPort` |
| TK-22 (US-009) | LongNN | Consumes all of the above; its own tasks are the TK-22 checklist below |

### TK-16: module, tokens, login and guards

- [ ] F1.1 `AuthModule`, the module every auth story extends; export only the auth services and authorization contracts other modules may consume (moved from TK-22 task 1.4, #19)
  - _Requirements: REQ-UBI-14_
- [ ] F1.2 `User.tokenVersion` in one forward migration, carried as the access-token `ver` claim; never edit a merged migration (moved from TK-22 task 1.1, #19)
  - _Requirements: REQ-EVT-10, REQ-EVT-11, REQ-EVT-18_
- [ ] F1.3 `PasswordService`: policy from parameters, bcrypt with `BCRYPT_COST` (pre-#14 task 2.1)
  - _Requirements: REQ-UBI-02, REQ-ERR-04_
- [ ] F1.4 `TokenService`, access tokens: access JWT with the `ver` claim (access part of pre-#14 task 2.2)
  - _Requirements: REQ-EVT-01_
- [ ] F1.5 `AuthService.login` with atomic failure counting and lockout (pre-#14 task 2.3)
  - _Requirements: REQ-EVT-01, REQ-STA-01, REQ-STA-02, REQ-ERR-01, AC-04_
- [ ] F1.6 `JwtStrategy` rejecting tokens with a stale `ver`; `JwtAuthGuard`; `@CurrentUser()` (pre-#14 task 3.1)
  - _Requirements: REQ-EVT-10, REQ-EVT-11, REQ-EVT-18 (pre-#14 citation REQ-EVT-11, renumbered by #14)_
- [ ] F1.7 Emit `audit.record` for the auth events through the platform sink (pre-#14 task 2.10). The pre-#14 wording named REQ-EVT-01 to REQ-EVT-11; after #14 the TK-22 account events are published by TK-22 task 4.5 (REQ-EVT-21)
  - _Requirements: US-004_

### TK-18: refresh tokens

- [ ] F2.1 `TokenService`, refresh tokens: opaque refresh tokens stored as hashes, rotation in one transaction, family revocation, reuse detection (refresh part of pre-#14 task 2.2)
  - _Requirements: REQ-UBI-03, REQ-EVT-02, REQ-EVT-03, REQ-ERR-02, AC-02_

### TK-19: per-account revocation

- [ ] F3.1 Revoke every refresh token of one account and advance `User.tokenVersion` inside the caller's Prisma transaction client, so the previous `ver` fails on the next authenticated request (moved from TK-22 task 4.1, #19)
  - _Requirements: REQ-EVT-10, REQ-EVT-18, AC-13, AC-14_

### TK-21: authorization infrastructure

- [ ] F4.1 `AbilityFactory`: permission rows to CASL rules with `${user.*}` interpolation; per-user 30 s cache; invalidation hook (pre-#14 task 3.2)
  - _Requirements: REQ-UBI-05, REQ-EVT-10, REQ-EVT-11 (pre-#14 citation REQ-EVT-10, split by #14)_
- [ ] F4.2 `SCOPE_PROVIDER` token and lazy resolution through `ModuleRef` `[Q44]` (pre-#14 task 3.3)
  - _Requirements: REQ-UBI-07, REQ-STA-03, design §2.3_
- [ ] F4.3 `PoliciesGuard` and `@CheckPolicies()`; `accessibleWhere()` helper for list queries (adds `@casl/prisma`, a dependency bump flagged in C-003) (pre-#14 task 3.4)
  - _Requirements: REQ-UBI-06_
- [ ] F4.4 Scoped-404 convention helper `assertInScopeOr404()` (pre-#14 task 3.5)
  - _Requirements: REQ-ERR-07_
- [ ] F4.5 Route-enumeration test: every non-GET route has both guards and a declared policy (pre-#14 task 3.6)
  - _Requirements: AC-07, BR-14_

### TK-15: one-time codes and mail

- [ ] F5.1 `OtpService`: 6-digit codes, hashing, attempts, TTL, cooldown (pre-#14 task 2.4)
  - _Requirements: REQ-ERR-03, REQ-ERR-09_
- [ ] F5.2 `MailPort` with `console` and `smtp` adapters; production guard on `console` (pre-#14 task 2.5)
  - _Requirements: REQ-OPT-02_

## TK-22 checklist: Admin Account Management

This checklist is limited to TK-22: Admin list, detail, invitation-based creation, complete role replacement, deactivation, reactivation, invitation acceptance and invitation resend. It excludes registration, login, OAuth, password reset, profile editing, account deletion, role creation and permission administration.

### Shared prerequisites and ownership boundaries

TK-22 consumes the shared auth foundation above and the platform `audit.record` publisher: `AuthModule`, `JwtAuthGuard` and `@CurrentUser()` (TK-16), `PoliciesGuard`, `@CheckPolicies()` and CASL ability construction (TK-21), `PasswordService` and access-token version validation (TK-16), refresh-token revocation (TK-18 and TK-19), and `MailPort` (TK-15). Rebase onto each owner's merged implementation before the dependent TK-22 task. Do not duplicate a provider or access another module's Prisma models directly.

Tasks below add only the TK-22 surface to the shared `AuthModule`. Any further foundation conflict is resolved by KhoaDD before implementation begins.

### Phase 1: Persistence and module contracts

- [ ] 1.1 Extend the Prisma auth schema with the invitation additions and add one forward migration
  - Add `InvitationToken`, its user and creator relations, the required indexes and `auth.invitationTtlHours=24` seed data. `User.tokenVersion` is built by TK-16 (F1.2, #19).
  - Preserve the existing `User`, `Role`, `UserRole`, `RefreshToken`, `OneTimeCode` and soft-delete ownership under `auth`; add no TK-22 delete endpoint and never edit a merged migration.
  - Run Prisma format, validation and client generation against the new schema.
  - _Requirements: REQ-UBI-03, REQ-UBI-09, REQ-UBI-14, REQ-EVT-15, REQ-EVT-16, REQ-EVT-17_

- [ ] 1.2 Add TK-22 error codes, DTOs and response projections
  - Add `VALIDATION_ERROR`, `INVALID_ROLE`, `INVALID_DATE_RANGE`, `INVITATION_INVALID`, `INVITATION_NOT_PENDING`, `ACCOUNT_NOT_FOUND`, `EMAIL_TAKEN` and `LAST_ADMIN` to the shared error catalogue without changing the four-key response envelope.
  - Implement class-validator DTOs for list filters, create, role replacement, invitation acceptance and UUID path parameters.
  - Implement one `AdminAccountDto` projection and paged result type that omit hashes, raw tokens and codes.
  - _Requirements: REQ-UBI-10, REQ-UBI-11, REQ-ERR-05, REQ-ERR-08, REQ-ERR-10, REQ-ERR-11, REQ-ERR-12, REQ-ERR-14, REQ-ERR-16_

- [ ] 1.3 Implement `RoleAssignmentPolicy`
  - Load role rows through Prisma and validate complete role sets without a TypeScript role enum.
  - Require `CUSTOMER` accounts to hold only `CUSTOMER`; require `STAFF` accounts to hold one or more Staff roles; normalize duplicate keys.
  - Return 400 `INVALID_ROLE` for empty, unknown or account-type-incompatible input.
  - _Requirements: REQ-UBI-04, REQ-UBI-05, REQ-ERR-11, AC-11_

- [ ] 1.4 Add the TK-22 controllers and services to the shared `AuthModule`
  - Register `UsersController`, `InvitationsController`, `UsersService`, `InvitationService` and the read-only TK-22 role query provider in the `AuthModule` that TK-16 creates (F1.1, #19).
  - Pass the caller's Prisma transaction client to invitation persistence and to the TK-19 per-account revocation (F3.1), so all related writes use the same interactive transaction.
  - _Requirements: REQ-UBI-06, REQ-UBI-12, REQ-UBI-14_

### Phase 2: Invitation and account creation logic

- [ ] 2.1 Implement secure invitation issuance and consumption
  - Generate a 256-bit opaque token, persist only its SHA-256 hash, apply the configured 24-hour expiry and compare hashes without logging secrets.
  - Consume a valid token once in a Prisma transaction that hashes the submitted password, sets `emailVerifiedAt`, activates the account and marks the invitation consumed.
  - Reject unknown, expired, consumed or superseded tokens with 400 `INVITATION_INVALID` and leave the account unchanged.
  - _Requirements: REQ-UBI-02, REQ-UBI-03, REQ-EVT-16, REQ-ERR-04, REQ-ERR-14_

- [ ] 2.2 Implement Admin invitation-based account creation
  - Normalize email to lower case, enforce uniqueness across active, inactive and soft-deleted accounts and derive a unique internal username from the email local part.
  - In one Prisma transaction, create an inactive passwordless account, assign the validated complete role set, record `createdById` and issue the invitation.
  - Send the raw invitation link through `MailPort` only after commit; preserve the inactive account and pending invitation if delivery fails.
  - _Requirements: REQ-UBI-01, REQ-UBI-13, REQ-EVT-05, REQ-EVT-15, REQ-ERR-05, REQ-ERR-11, REQ-ERR-16, AC-11, AC-12_

- [ ] 2.3 Implement invitation resend
  - Permit resend only for an inactive account with incomplete invitation setup.
  - Supersede every unconsumed invitation and insert one fresh hashed token in one Prisma transaction, then send the new link after commit.
  - Return 404 `ACCOUNT_NOT_FOUND` for an unknown id and 409 `INVITATION_NOT_PENDING` for an account that completed setup or was deactivated after setup.
  - _Requirements: REQ-EVT-17, REQ-ERR-10, REQ-ERR-14_

### Phase 3: Account queries

- [ ] 3.1 Implement the paginated Admin account list
  - Exclude rows whose `deletedAt` is set and combine optional account type, assigned role, active status, case-insensitive full-name or email search, `createdFrom` and `createdTo` filters in one Prisma where clause.
  - Support 1-based `page`, default `limit=20`, maximum `limit=100`, and stable `createdAt DESC, id DESC` ordering.
  - Return `{ items, page, limit, totalCount, totalPages }`; reject invalid pagination with `VALIDATION_ERROR` and invalid dates with `INVALID_DATE_RANGE`.
  - _Requirements: REQ-EVT-12, REQ-EVT-13, REQ-ERR-12, AC-10_

- [ ] 3.2 Implement Admin account detail and role option queries
  - Return the shared account projection for an existing non-deleted id, including active Admin accounts, and return 404 `ACCOUNT_NOT_FOUND` for unknown or soft-deleted ids.
  - Return data-driven roles with account type metadata for the Admin create and role-replacement forms.
  - Keep password, refresh-token, invitation and reset-code data outside both projections.
  - _Requirements: REQ-UBI-09, REQ-UBI-11, REQ-EVT-14, REQ-ERR-10, AC-16, AC-17_

### Phase 4: Role and account-status mutations

- [ ] 4.1 Invalidate sessions inside TK-22 transactions
  - Call the TK-19 per-account revocation (F3.1) with the caller's Prisma transaction client; it revokes every refresh token of the account and advances `User.tokenVersion`, and the TK-16 `JwtStrategy` (F1.6) rejects the previous `ver` on the next authenticated request.
  - Invalidate any per-user ability cache (TK-21, F4.1) after a committed role replacement.
  - _Requirements: REQ-EVT-10, REQ-EVT-18, AC-13, AC-14_

- [ ] 4.2 Implement complete role replacement
  - Define one module-private `const LAST_ADMIN_LOCK_KEY = 7_340_001n` and an auth-owned helper that acquires `pg_advisory_xact_lock(${LAST_ADMIN_LOCK_KEY})` through `tx.$executeRaw` inside the caller's interactive Prisma transaction.
  - After the advisory lock, lock the non-deleted target with a parameterized `SELECT ... FOR UPDATE` through `tx.$queryRaw` on the same transaction client.
  - After both locks, validate the complete role set, permit changes to the caller or another active Admin, and verify that the proposed replacement retains at least one active Admin.
  - Replace all `UserRole` rows, increment `tokenVersion` and revoke refresh tokens before committing the same transaction.
  - Return 409 `LAST_ADMIN` and roll back when the proposed replacement would leave zero active Admins.
  - _Requirements: REQ-EVT-10, REQ-ERR-08, REQ-ERR-10, REQ-ERR-11, AC-13, AC-16_

- [ ] 4.3 Implement idempotent deactivation
  - In one interactive Prisma transaction, call the same `$executeRaw` last-Admin advisory-lock helper, then lock the non-deleted target with a parameterized `SELECT ... FOR UPDATE` through `tx.$queryRaw` on the same transaction client.
  - After locking, return the current account with 200 and perform no write when it is already inactive; apply the self-deactivation check only when the target is active.
  - Reject active-target self-deactivation with 403 `FORBIDDEN`; permit deactivating another Admin when at least one active Admin remains.
  - Check the post-write active Admin count, set `isActive=false`, increment `tokenVersion` and revoke every refresh token before committing; return 409 `LAST_ADMIN` and roll back if the count would be zero.
  - _Requirements: REQ-EVT-18, REQ-EVT-20, REQ-ERR-08, REQ-ERR-10, AC-14, AC-16_

- [ ] 4.4 Implement idempotent reactivation
  - Return the current account with 200 and perform no write when it is already active.
  - Reactivate an inactive account, including one holding `ADMIN`, by changing only `isActive`; preserve roles, profile and password.
  - _Requirements: REQ-EVT-19, REQ-EVT-20, REQ-ERR-10, AC-15, AC-16_

- [ ] 4.5 Publish redacted post-commit audit events
  - Publish `user.create`, `user.invitation.resend`, `user.roles.replace`, `user.deactivate` and `user.reactivate` with actor, subject and redacted before and after values.
  - Do not emit a mutation event for an idempotent no-op; never include password, token or code material.
  - Consume the platform audit publisher so sink failure is logged and never rolls back or changes a completed account result.
  - _Requirements: REQ-EVT-21, REQ-ERR-15, AC-18_

### Phase 5: HTTP presentation and authorization

- [ ] 5.1 Implement the specified TK-22 controllers
  - Implement API contracts 10, 11, 12, 14, 16 and 18 to 21 with `@ResponseMessage`, Swagger metadata and exact documented status codes and messages.
  - Apply `JwtAuthGuard` and `PoliciesGuard` to every Admin route; declare CASL policies using `can(action, subject, fields)` and leave only invitation acceptance public.
  - Do not implement deferred API 13 or expose profile, password or deletion mutations.
  - _Requirements: REQ-UBI-06, REQ-UBI-10, REQ-UBI-12, AC-17_

- [ ] 5.2 Add controller and policy metadata unit tests
  - Assert every Admin route requires both guards and the expected CASL action, subject and fields.
  - Assert public invitation acceptance has no Admin policy and that all handler results use the global envelope contract.
  - Assert non-Admin callers receive 403 and unauthenticated callers receive 401 through the guard fixtures.
  - _Requirements: REQ-UBI-06, REQ-UBI-10, REQ-UBI-12_

### Phase 6: Backend unit verification

- [ ] 6.1 Unit test role validation and account queries
  - Cover Customer and multi-role Staff success, seeded and extensible Staff roles, empty, duplicate, unknown and incompatible role inputs.
  - Cover each list filter alone and combined, case-insensitive search, newest-first tie-break, default and maximum pagination, invalid ranges, empty results, soft-deleted exclusion and account-not-found detail.
  - _Requirements: REQ-UBI-04, REQ-EVT-12, REQ-EVT-13, REQ-EVT-14, REQ-ERR-10, REQ-ERR-11, REQ-ERR-12_

- [ ] 6.2 Unit test creation and invitations
  - Cover Customer, Staff and Admin creation, username collision suffixing, mixed-case duplicate email, missing fields and transaction rollback.
  - Cover hash-only persistence, expiry, single consumption, supersession, resend and invalid resend state.
  - Mock mail success and failure; assert mail failure does not erase the committed inactive account.
  - _Requirements: REQ-UBI-02, REQ-UBI-03, REQ-UBI-13, REQ-EVT-15, REQ-EVT-16, REQ-EVT-17, REQ-ERR-05, REQ-ERR-14, REQ-ERR-16_

- [ ] 6.3 Test role and status transactions
  - Cover successful role replacement, deactivation and reactivation; self-role change; self-deactivation rejection; other Admin role change and deactivation; last-Admin rollback; inactive Admin reactivation; unknown and soft-deleted accounts; and idempotent no-ops.
  - Assert role replacement and deactivation use `$executeRaw` with the same `LAST_ADMIN_LOCK_KEY` before using `$queryRaw` for the parameterized target-row lock and then reading the active Admin count.
  - Assert role rows, status, `tokenVersion` and refresh-token revocation share one transaction and roll back together on failure.
  - Add a PostgreSQL-backed concurrency test that starts opposing deactivations by two active Admins in parallel; assert exactly one succeeds, the other receives 409 `LAST_ADMIN`, and one active Admin remains.
  - Assert reactivation does not write account type, roles, profile or password.
  - _Requirements: REQ-EVT-10, REQ-EVT-18, REQ-EVT-19, REQ-EVT-20, REQ-ERR-08, REQ-ERR-10_

- [ ] 6.4 Unit test audit and sensitive-field boundaries
  - Cover the event payload for every successful mutation, absence on idempotent no-ops, redaction and non-blocking sink failure.
  - Assert every TK-22 projection excludes password hashes, raw invitation tokens, token hashes, refresh tokens and reset codes.
  - _Requirements: REQ-UBI-11, REQ-EVT-21, REQ-ERR-15, AC-17, AC-18_

### Phase 7: Admin user-management frontend

- [ ] 7.1 Add frontend test infrastructure and TK-22 API types
  - Add Vitest, React Testing Library, user-event, jsdom and a frontend `test` script.
  - Add `AdminAccount`, role-option, paged query and mutation types, query keys and API functions for contracts 10, 11, 12, 14, 16 and 18 to 21.
  - Extend `ApiError` to retain `result.errorCode` while preserving the four-key envelope parser.
  - _Requirements: REQ-UBI-10, REQ-UBI-11, REQ-EVT-22, AC-17_

- [ ] 7.2 Build the Admin account list and detail experience
  - Add `pages/AdminUsersPage`, `widgets/AdminUserTable` and `entities/user` using URL-backed filters and TanStack Query pagination.
  - Implement loading, empty, error and populated states plus a route-addressable detail drawer or page.
  - Display the specified operational fields and no sensitive fields; exclude soft-deleted accounts from list and detail results.
  - _Requirements: REQ-EVT-12, REQ-EVT-13, REQ-EVT-14, REQ-EVT-22, AC-10, AC-17, AC-19_

- [ ] 7.3 Build create and invitation experiences
  - Add an Admin create form with React Hook Form and Zod mirroring the backend DTO; fix Customer to the `CUSTOMER` role and load Staff roles from the API.
  - Add invitation-resend feedback for eligible inactive accounts and a public invitation-acceptance page that sets the password without exposing the token after submission.
  - Invalidate list and detail query keys after successful mutations and display stable server errors.
  - _Requirements: REQ-EVT-15, REQ-EVT-16, REQ-EVT-17, REQ-EVT-22, REQ-ERR-05, REQ-ERR-11, REQ-ERR-14, REQ-ERR-16, AC-11, AC-12_

- [ ] 7.4 Build role and status actions
  - Add complete role-replacement, deactivate and reactivate dialogs with confirmation and server outcome feedback.
  - Disable Deactivate only for the current Admin's own account; permit role changes for self and other Admins, permit deactivation of another Admin, surface `LAST_ADMIN`, and allow Reactivate for inactive Admin accounts.
  - After a successful self-role change, clear the stale auth session and redirect to login with a role-change message before invalidated queries can surface a generic 401.
  - Preserve the current detail route and refresh both list and detail queries after success.
  - _Requirements: REQ-EVT-10, REQ-EVT-18, REQ-EVT-19, REQ-EVT-20, REQ-EVT-22, REQ-ERR-08, AC-13, AC-14, AC-15, AC-16_

- [ ] 7.5 Unit test frontend behavior and accessibility
  - Cover query serialization, combined filters, pagination and TanStack Query cache invalidation.
  - Cover form validation, Customer and Staff role behavior, server error codes, idempotent outcomes, self-deactivation control, self-role-change logout and redirect, other Admin actions and `LAST_ADMIN` feedback.
  - Cover keyboard operation, focus restoration, labelled controls, programmatic validation messages, announced async status and loading, empty, success and failure states.
  - _Requirements: REQ-EVT-22, AC-19, NFR-USE-03_

### Phase 8: Automated completion gates

- [ ] 8.1 Run and pass the backend gates
  - Run Prisma validation and generation, TK-22 Jest unit tests, the PostgreSQL-backed last-Admin concurrency test, the full backend unit suite, lint including module boundaries, typecheck and build.
  - Fix failures within the approved specification; update the governing spec immediately if a verified implementation fact disproves it.
  - _Requirements: TK-22 unit verification, REQ-UBI-14_

- [ ] 8.2 Run and pass the frontend gates
  - Run the TK-22 frontend unit suite, full frontend tests, lint, typecheck and production build.
  - Record the exact passing commands and results for the PR evidence; do not open the PR while any required unit test fails.
  - _Requirements: TK-22 unit verification, AC-19_

- [ ] 8.3 Complete the contract and scope audit
  - Verify behavior against API contracts 10, 11, 12, 14, 16 and 18 to 21, including envelope shape and every documented failure.
  - Verify API 13, profile edits, password administration, delete endpoints, `deletedAt` mutations and custom role administration remain outside the TK-22 diff while the existing soft-delete invariant remains intact.
  - Update the session ledger with test evidence and any specification corrections made during implementation.
  - _Requirements: REQ-UBI-09, REQ-UBI-10, REQ-UBI-11, AC-17_

## TK-20 checklist: Password reset

> Status: awaiting KhoaDD approval on the TK-20 spec PR. Four leader decisions are open in #24; tasks that depend on one name it. Owner HoangTK, reviewer KhoaDD.

This checklist is limited to TK-20: the public forgot-password request (API 06), the public reset with a code (API 07) and the Staff-triggered reset (API 15). It excludes the OTP and mail infrastructure (TK-15), token revocation (TK-19), account profile edits (API 13, deferred) and any Staff screen unless #24 Q4 adds one.

### Shared prerequisites and ownership boundaries

TK-20 consumes, and never re-implements: `AuthModule`, `PasswordService`, `JwtAuthGuard`, `@CurrentUser()` and the auth `audit.record` emission (TK-16, F1.1, F1.3, F1.6, F1.7); per-account revocation that also advances `User.tokenVersion` (TK-19, F3.1); `OtpService` and `MailPort` (TK-15, F5.1, F5.2); `PoliciesGuard`, `@CheckPolicies()` and `assertInScopeOr404()` (TK-21, F4.3, F4.4); `ParameterService` for the `auth.otp*` and `auth.passwordMinLength` keys (platform 2.4). Implementation starts only after all of them are merged on `dev`. `OneTimeCode` with purpose `PASSWORD_RESET` is already in the schema; TK-20 adds no migration.

### Phase 1: Contracts

- [ ] 1.1 Add `OTP_INVALID`, `OTP_COOLDOWN`, `PASSWORD_POLICY_VIOLATION` and `NO_REGISTERED_EMAIL` to the shared error catalogue where TK-15 or TK-16 has not already added them, without changing the four-key envelope
  - _Requirements: REQ-ERR-03, REQ-ERR-04, REQ-ERR-06, REQ-ERR-09, design §2.7_
- [ ] 1.2 Add class-validator DTOs: `ForgotPasswordDto` (`identifier`), `ResetPasswordDto` (`identifier`, 6-digit `code`, `newPassword`) and `TriggerPasswordResetDto` (`verificationMethod` of `PHONE_CALLBACK` or `IN_PERSON`, required `note`), plus the UUID path parameter for API 15
  - _Requirements: API 06, API 07, API 15, Q35_

### Phase 2: Core service logic

- [ ] 2.1 `AuthService.forgot`: resolve the identifier as a case-insensitive username or email; for an existing account with a registered email, issue a `PASSWORD_RESET` code through `OtpService` and send it through `MailPort`; return the same neutral 200 when the account is unknown or has no email; emit `auth.password.forgot`. The cooldown response follows #24 Q2
  - _Requirements: REQ-EVT-07, REQ-ERR-09, NFR enumeration resistance, API 06_
- [ ] 2.2 `AuthService.reset`: verify the latest unconsumed `PASSWORD_RESET` or `SET_PASSWORD` code through `OtpService`, counting attempts; return 400 `OTP_INVALID` for a wrong, expired, consumed or exhausted code; check the new password with `PasswordService` and return 400 `PASSWORD_POLICY_VIOLATION` naming the unmet rule
  - _Requirements: REQ-EVT-08, REQ-ERR-03, REQ-ERR-04, API 07_
- [ ] 2.3 In one Prisma transaction, store the new bcrypt hash, consume the code and call the TK-19 per-account revocation (F3.1) with the transaction client; emit `auth.password.reset` after commit; leave no partial state on failure
  - _Requirements: REQ-UBI-02, REQ-UBI-03, REQ-EVT-08, API 07_
- [ ] 2.4 `UsersService.triggerPasswordReset`: return 404 `NOT_FOUND` for an unknown id or an account outside the caller's `resetPassword` scope (an Operator reaches Customer accounts only); return 409 `NO_REGISTERED_EMAIL` and send nothing when the account has no email; otherwise issue a `PASSWORD_RESET` code, send it only to the registered email, return only the masked address and emit `user.password.reset_triggered` with the verification method and note. Adding an email first follows #24 Q1
  - _Requirements: REQ-EVT-09, REQ-ERR-06, REQ-ERR-09, AC-06, API 15, design §1.2_

### Phase 3: HTTP presentation and authorization

- [ ] 3.1 `AuthController` routes 06 and 07, public, with `@ResponseMessage` and the exact documented messages; apply the API 06 limit of 5 requests per IP per 10 minutes through the rate-limiting mechanism decided in #24 Q3
  - _Requirements: API 06, API 07, D-002_
- [ ] 3.2 `UsersController` route 15 with `JwtAuthGuard`, `PoliciesGuard` and `@CheckPolicies()` for `resetPassword` on `User`, Swagger metadata and the exact documented status codes
  - _Requirements: REQ-UBI-06, API 15, AC-07_

### Phase 4: Backend verification

- [ ] 4.1 Unit test `forgot`: existing account with email, existing account without email, unknown identifier, identical responses across those three, and the cooldown behaviour decided in #24 Q2
  - _Requirements: REQ-EVT-07, REQ-ERR-09_
- [ ] 4.2 Unit test `reset`: valid `PASSWORD_RESET` and `SET_PASSWORD` codes, wrong, expired and consumed codes, attempt exhaustion, policy failure, one transaction client for the hash, the code and the TK-19 revocation, and rollback on failure
  - _Requirements: REQ-EVT-08, REQ-ERR-03, REQ-ERR-04_
- [ ] 4.3 Unit test `triggerPasswordReset`: Operator on a Customer, Operator on a Staff account (404), Admin, unknown id (404), no registered email (409 with no mail sent), masked address only, no code or credential in the response or the audit payload
  - _Requirements: REQ-EVT-09, REQ-ERR-06, AC-06_
- [ ] 4.4 Controller metadata tests: route 15 carries both guards and the `resetPassword` policy; routes 06 and 07 are public
  - _Requirements: REQ-UBI-06, AC-07_
- [ ] 4.5 E2E for AC-06 with `MAIL_TRANSPORT=console`: the Staff response has no code, and the console transport shows the code sent only to the registered email
  - _Requirements: AC-06, REQ-OPT-02_

### Phase 5: Frontend

- [ ] 5.1 `features/auth` forgot and reset password as a two-step flow, with Zod schemas mirroring `ForgotPasswordDto` and `ResetPasswordDto`, the neutral confirmation message, and field-level display of `OTP_INVALID`, `OTP_COOLDOWN` and `PASSWORD_POLICY_VIOLATION`
  - _Requirements: design §5, API 06, API 07_
- [ ] 5.2 Unit test the two-step flow: validation, server error display, loading, success and failure states, keyboard operation and labelled controls. A Staff trigger screen is added only if #24 Q4 decides so
  - _Requirements: design §5, NFR-USE-03_

### Phase 6: Completion gates

- [ ] 6.1 Backend: lint including module boundaries, typecheck, the full unit suite, the e2e suite and build
- [ ] 6.2 Frontend: lint, typecheck, unit tests and production build
- [ ] 6.3 Audit behaviour against API contracts 06, 07 and 15, including every documented failure and the envelope; record the evidence in the session ledger
  - _Requirements: D-002, D-026_
