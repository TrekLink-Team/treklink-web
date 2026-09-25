# Implementation Tasks: auth

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: stories US-001 to US-010 (keys `TK-9` to `TK-18` once Jira is populated)
>
> Fulfills `design.md`. **Blocked on** QUESTION C-002 items that re-confirm Q30 to Q46. Phase 1 may start once the approval names this module; tasks resting on an unconfirmed answer are marked `[Qnn]`.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 Prisma models `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `RefreshToken`, `OneTimeCode`, `GuideProfile`, enums `AccountType`, `OtpPurpose` (part of the platform initial migration, platform task 1.5)
  - _Requirements: design §1, REQ-UBI-01, REQ-UBI-03, REQ-UBI-04_
- [ ] 1.2 Seed: roles `ADMIN`, `OPERATOR`, `GUIDE` (STAFF), `CUSTOMER` (CUSTOMER), default permissions of design §1.2, one seed user per role with passwords from `SEED_*_PASSWORD`
  - _Requirements: US-001, AC-01_
- [ ] 1.3 DTOs with `class-validator`: `RegisterDto`, `VerifyEmailDto`, `LoginDto`, `RefreshDto`, `ForgotPasswordDto`, `ResetPasswordDto`, `UpdateSelfDto`, `CreateUserDto`, `UpdateUserDto`, `SetRolesDto`, `TriggerResetDto`, `SetPermissionsDto`
- [ ] 1.4 Error codes of design §2.7 added to the platform `ErrorCode` enum
- [ ] 1.5 Auth configuration namespace and parameter-registry keys of requirements §4

## Phase 2: Core Service Logic

- [ ] 2.1 `PasswordService`: policy from parameters, bcrypt with `BCRYPT_COST`
  - _Requirements: REQ-UBI-02, REQ-ERR-04_
- [ ] 2.2 `TokenService`: access JWT with `ver` claim, opaque refresh tokens, rotation in one transaction, family revocation, reuse detection
  - _Requirements: REQ-EVT-02, REQ-EVT-03, REQ-ERR-02, AC-02_
- [ ] 2.3 `AuthService.login` with atomic failure counting and lockout
  - _Requirements: REQ-EVT-01, REQ-STA-01, REQ-STA-02, REQ-ERR-01, AC-04_
- [ ] 2.4 `OtpService`: 6-digit codes, hashing, attempts, TTL, cooldown
  - _Requirements: REQ-ERR-03, REQ-ERR-09_
- [ ] 2.5 `MailPort` with `console` and `smtp` adapters; production guard on `console`
  - _Requirements: REQ-OPT-02_
- [ ] 2.6 Registration with username derivation and OTP verification `[Q31, Q41]`
  - _Requirements: REQ-EVT-04, REQ-EVT-05, AC-05_
- [ ] 2.7 Forgot, reset and Staff-triggered reset `[Q35]`
  - _Requirements: REQ-EVT-07, REQ-EVT-08, REQ-EVT-09, REQ-ERR-06, AC-06_
- [ ] 2.8 `UsersService`: provision (Flow 2), update, deactivate, soft delete, set roles, last-Admin guard, token revocation `[Q33, Q36, Q45]`
  - _Requirements: REQ-EVT-06, REQ-EVT-10, REQ-EVT-11, REQ-ERR-08_
- [ ] 2.9 `RolesService`: list, create role, set permissions, critical-permission guard
  - _Requirements: US-001, AC-08_
- [ ] 2.10 Emit `audit.record` for every event named in REQ-EVT-01 to REQ-EVT-11
  - _Requirements: US-004_
- [ ] 2.11 Unit tests: every branch above, including concurrent wrong-password race and refresh reuse

## Phase 3: Authorization infrastructure (exported to every module)

- [ ] 3.1 `JwtStrategy` rejecting tokens with a stale `ver`; `JwtAuthGuard`; `@CurrentUser()`
  - _Requirements: REQ-EVT-11_
- [ ] 3.2 `AbilityFactory`: permission rows to CASL rules with `${user.*}` interpolation; per-user 30 s cache; invalidation hook
  - _Requirements: REQ-UBI-05, REQ-EVT-10_
- [ ] 3.3 `SCOPE_PROVIDER` token and lazy resolution through `ModuleRef` `[Q44]`
  - _Requirements: REQ-UBI-07, REQ-STA-03, design §2.3_
- [ ] 3.4 `PoliciesGuard` and `@CheckPolicies()`; `accessibleWhere()` helper for list queries (adds `@casl/prisma`, a dependency bump flagged in C-002)
  - _Requirements: REQ-UBI-06_
- [ ] 3.5 Scoped-404 convention helper `assertInScopeOr404()`
  - _Requirements: REQ-ERR-07_
- [ ] 3.6 Route-enumeration test: every non-GET route has both guards and a declared policy
  - _Requirements: AC-07, BR-14_

## Phase 4: API Presentation Layer

- [ ] 4.1 `AuthController`, `UsersController`, `RolesController` per api-design 01 to 17, with `@ResponseMessage`
- [ ] 4.2 Rate limits on register, login, forgot (`@nestjs/throttler`, a new dependency flagged in C-002)
- [ ] 4.3 Swagger annotations
- [ ] 4.4 E2E tests against Docker Postgres: every Validation row of api-design 01 to 17; AC-01 to AC-09

## Phase 5: Frontend Integration

- [ ] 5.1 Login, registration with OTP step, forgot and reset pages; silent refresh; `AuthProvider` (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Test suite green; 6.2 lint, boundary check and typecheck clean; 6.3 api-design matches behaviour; 6.4 session file
- [ ] 6.5 Optional, only if approved: Google OAuth (REQ-OPT-01) with its own api-design files
