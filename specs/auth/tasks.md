# Implementation Tasks: TK-22 Admin Account Management

> Checklist approval: pending KhoaDD or designated lead
> Branch: `feat/TK-22-admin-manage-user-account` | Jira: `TK-22` | Story: `US-009`
> Requirements, design, endpoint contracts and this checklist remain under leader review on the specification PR.

This checklist is limited to TK-22: Admin list, detail, invitation-based creation, complete role replacement, deactivation, reactivation, invitation acceptance and invitation resend. It excludes registration, login, OAuth, password reset, profile editing, account deletion, role creation and permission administration.

## Shared prerequisites and ownership boundaries

TK-22 consumes these approved auth and platform contracts: `JwtAuthGuard`, `PoliciesGuard`, `@CheckPolicies()`, `@CurrentUser()`, CASL ability construction, `PasswordService`, `MailPort`, refresh-token revocation, access-token version validation and the platform `audit.record` publisher. If another branch owns one of these foundations, rebase its approved implementation before the dependent TK-22 task. Do not duplicate the provider or access another module's Prisma models directly.

The current branch contains the Prisma auth models and seeded system roles, but no implemented NestJS auth module. Tasks below create only the TK-22-owned module surface and the minimum extensions to shared auth contracts. Any broader foundation conflict must be resolved by KhoaDD or the designated lead before implementation begins.

## Phase 1: Persistence and module contracts

- [ ] 1.1 Extend the Prisma auth schema and add one forward migration
  - Add `User.tokenVersion`, `InvitationToken`, user and creator relations, the required indexes and `auth.invitationTtlHours=24` seed data.
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

- [ ] 1.4 Create the TK-22 auth module surface and transaction contracts
  - Add `AuthModule`, `UsersController`, `InvitationsController`, `UsersService`, `InvitationService` and the read-only TK-22 role query provider.
  - Define a transaction-client type used by invitation persistence and session revocation so all related Prisma writes use the same interactive transaction.
  - Export only the auth services and authorization contracts other modules are allowed to consume.
  - _Requirements: REQ-UBI-06, REQ-UBI-12, REQ-UBI-14_

## Phase 2: Invitation and account creation logic

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

## Phase 3: Account queries

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

## Phase 4: Role and account-status mutations

- [ ] 4.1 Extend session invalidation for TK-22 transactions
  - Provide a same-module method that revokes every refresh token for one account using the caller's Prisma transaction client.
  - Increment `User.tokenVersion` in the same transaction; ensure JWT validation rejects the previous `ver` on the next authenticated request.
  - Invalidate any per-user ability cache after a committed role replacement.
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

## Phase 5: HTTP presentation and authorization

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

## Phase 6: Backend unit verification

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

## Phase 7: Admin user-management frontend

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

## Phase 8: Automated completion gates

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
