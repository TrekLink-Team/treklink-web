# Requirements Specification: auth

**User Story**: As **any TrekLink user**, I want to sign in once with my username and receive exactly the access my role allows, and as an **Admin**, I want to manage user accounts, so that I can provision access and keep account status and role assignments current.
**Story IDs**: US-001 to US-010 (E1) | **Priority**: High | **Main Flow**: MF-01 (prerequisite of every flow) | **Owner of the flow**: TanNB (MF-01); story owners per backlog

> **Authority**: D-002 (envelope), D-015 (configuration), D-024 (prose), D-028 (platform audit sink), and the confirmed clarification answers in `07-clarification-answers.md` §6. TK-22 account-administration rules were clarified by the story owner on 2026-09-29 and require approval through this specification gate before design or implementation.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Accounts with **username as the primary identifier**; email optional and linkable `[Q41]`
  - Two account types, **Customer** and **Staff**; Staff carries one or more sub-roles **Operator, Guide, Admin**, extensible as data `[Q33]`
  - Self-registration by email OTP (Flow 1) and Staff- or Guide-provisioned Customer accounts (Flow 2) `[Q30, Q31]`
  - JWT access tokens, rotating refresh tokens with reuse detection, logout and revocation `[Q34]` (US-003, US-005, US-006)
  - Password policy, lockout, password reset by email OTP, Staff-triggered reset that never reveals the password `[Q35]` (US-007)
  - Data-driven RBAC: roles, permissions and CASL conditions stored as rows and loaded per request (US-001, US-008) `[Q43]`
  - Guide profile: skills, certifications, languages (US-010) `[Q33]`
  - Account status through `isActive`; soft-deleted accounts remain retained for audit, while TK-22 exposes no delete endpoint and does not change `deletedAt`
  - Authentication audit: login success and failure, logout, token reuse, reset, role change (US-004) `[Q46]`
  - TK-22 backend operations: paginated list, account detail, invitation-based creation, role change, deactivation and reactivation
  - TK-22 Admin UI for those six operations, including loading, empty, validation, success and failure states
- **Out-of-Scope**:
  - Multi-tenancy; there is one tenant `[Q32]`
  - Google OAuth sign-in: specified as an **optional feature** (REQ-OPT-01) behind a flag, not in the Phase B build unless the approval names it
  - SMS OTP, social logins other than Google, MFA for Staff
  - Identity documents of any kind (NFR-LEG-02)
  - Admin editing of account email, full name, phone number or password under TK-22
  - Direct password assignment by an Admin
  - Account hard deletion, soft deletion and custom role creation under TK-22
- **Depends on**: `platform` (envelope, parameters and audit sink). The auth module owns its email-delivery adapter. Every other module depends on auth for `JwtAuthGuard`, `PoliciesGuard` and `@CurrentUser()`.

### Traceability

| Requirement group | MF | UC | FR | BR | Story |
|---|---|---|---|---|---|
| Sign in, tokens, logout | all | UC-21 | FR-AUTH-02 (new) | | US-003, US-005, US-006 |
| Every mutating endpoint guarded | all | | FR-AUTH-01 | BR-14 | US-008 |
| Guide sees own trip only | MF-03, MF-04 | UC-14 | FR-AUTH-03 | BR-13 | US-008 |
| Registration | MF-01 | UC-27 Register Account (new) | FR-AUTH-04 (new) | | US-002 |
| Password reset | | UC-28 Reset Password (new) | FR-AUTH-05 (new) | | US-007 |
| User account administration | | UC-18 | FR-AUTH-06 | | US-009 / TK-22 |
| Role and permission administration | | UC-18 | FR-AUTH-07 (new) | | US-001 |
| Auth audit | | UC-20 | FR-AUTH-08 (new) | | US-004 |
| Guide profile | MF-01 | | FR-AUTH-09 (new) | | US-010 |

"New" FR and UC identifiers are proposed additions to the SRS; REQUEST entry C-004 lists them.

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL identify every account by a unique, case-insensitive `username` of 3 to 32 characters from `[a-z0-9._-]`. `[Q41]`
- **REQ-UBI-02**: The system SHALL store passwords only as bcrypt hashes with the configured cost, and SHALL never persist, log or return a plaintext password. [NFR-SEC-02]
- **REQ-UBI-03**: The system SHALL store refresh tokens, invitation tokens, OTP codes and reset codes only as hashes.
- **REQ-UBI-04**: The system SHALL give every account exactly one `accountType`: `CUSTOMER` accounts hold only the `CUSTOMER` role; `STAFF` accounts hold one or more extensible Staff sub-roles, including `OPERATOR`, `GUIDE` and `ADMIN`. `[Q33]`
- **REQ-UBI-05**: The system SHALL resolve a user's permissions from the union of all assigned role permissions and SHALL evaluate every CASL `can(action, subject, fields)` condition server-side. [NFR-SEC-03]
- **REQ-UBI-06**: The system SHALL protect every mutating endpoint in every module with both `JwtAuthGuard` and a `PoliciesGuard` check declared on the handler. [FR-AUTH-01, BR-14, NFR-SEC-01]
- **REQ-UBI-07**: The system SHALL scope every Guide read of trips, devices, rentals, incidents and live positions to the trips the Guide is currently assigned to. [FR-AUTH-03, BR-13] `[Q44]`
- **REQ-UBI-08**: The system SHALL NOT let Admin perform operational actions (acknowledging incidents, confirming bookings, checking devices in or out) by virtue of the Admin role; Admin generalises Staff for **read** access only. [`06-requirements-foundation.md` §2]
- **REQ-UBI-09**: The system SHALL soft-delete accounts (`deletedAt`), never hard-delete them, and SHALL keep them resolvable in audit trails. `[Q36]`
- **REQ-UBI-10**: Every TK-22 endpoint SHALL return the four-key response envelope `{ result, isSuccess, statusCode, message }`; a failure SHALL place its stable `errorCode` inside `result`. [D-002, D-026]
- **REQ-UBI-11**: TK-22 account responses SHALL expose `id`, `username`, `email`, `fullName`, `phoneNumber`, `accountType`, `roles`, `isActive`, `lastLoginAt`, `createdAt` and `updatedAt`, and SHALL NOT expose password hashes, invitation tokens, refresh tokens or reset codes.
- **REQ-UBI-12**: Only an authenticated `ADMIN` caller whose CASL policy permits the requested `User` action SHALL access a TK-22 backend operation or Admin user-management screen.
- **REQ-UBI-13**: Email uniqueness and lookup SHALL be case-insensitive across active, inactive and soft-deleted accounts, so a retained account's email cannot be reused.
- **REQ-UBI-14**: The auth module SHALL own account, role, invitation and authentication-token persistence; other modules SHALL use only services and authorization contracts exported by auth.

### Event-Driven

- **REQ-EVT-01**: WHEN a user submits a valid identifier (username or email) and password for an active account, the system SHALL issue an access token and a refresh token, record `lastLoginAt`, and audit `auth.login.success`. [UC-21, US-003]
- **REQ-EVT-02**: WHEN a refresh token is presented that is valid and not revoked, the system SHALL revoke it, issue a new access and refresh token pair in the same token family, and link the old token to its replacement. [US-005]
- **REQ-EVT-03**: WHEN a user logs out, the system SHALL revoke the presented refresh token's entire family and audit `auth.logout`. [US-006]
- **REQ-EVT-04**: WHEN a visitor self-registers with a username, email, password, full name and optional phone, the system SHALL create an inactive `CUSTOMER` account, send a verification OTP to the email, and activate the account only when the OTP is verified. [Flow 1, US-002] `[Q31]`
- **REQ-EVT-05**: WHEN account creation omits a username, the system SHALL derive one from the email local part, lower-cased and stripped to the allowed alphabet, appending the smallest numeric suffix that makes it unique (`name123@mail.com` becomes `name123`, then `name1231`).
- **REQ-EVT-06**: WHEN a Staff or Guide user provisions a Customer account through Flow 2, the system SHALL create it active, record `createdById`, and, IF an email is given, send a set-password OTP to that email. `[Q31]`
- **REQ-EVT-07**: WHEN a password reset is requested for an identifier, the system SHALL send a reset OTP to the account's registered email if one exists, and SHALL return the same success response whether or not the identifier exists. [US-007] `[Q35]`
- **REQ-EVT-08**: WHEN a valid reset OTP and a policy-compliant new password are submitted, the system SHALL set the new hash, revoke every refresh token of the account, and audit `auth.password.reset`.
- **REQ-EVT-09**: WHEN Staff triggers a reset for a Customer, the system SHALL send the reset OTP **only** to the email already registered on the account and SHALL NOT return the code, a temporary password or any credential to the Staff member. `[Q35]`
- **REQ-EVT-10**: WHEN an Admin changes an account's role assignment and the change retains at least one active account holding `ADMIN`, the system SHALL replace the complete existing role set with the submitted valid role set, advance `User.tokenVersion`, revoke all refresh-token families in the same transaction so issued access tokens fail on their next authenticated request, and audit the previous and new role sets. [US-009]
- **REQ-EVT-11**: WHEN an Admin changes a role's permissions under US-001, the system SHALL apply the permission change to affected users on their next request, revoke their refresh-token families, invalidate their issued access tokens, and audit the before and after permission sets.
- **REQ-EVT-12**: WHEN an Admin requests the account list, the system SHALL return accounts whose `deletedAt` is null in descending `createdAt` order using `page` and `limit`, with a default limit of 20 and a maximum limit of 100, nested in the shared paged-result envelope.
- **REQ-EVT-13**: WHEN an Admin filters the account list, the system SHALL support account type, assigned role, active status, case-insensitive name or email search, `createdFrom` and `createdTo`, and SHALL combine supplied filters.
- **REQ-EVT-14**: WHEN an Admin requests an existing account whose `deletedAt` is null by id, the system SHALL return its TK-22 account response.
- **REQ-EVT-15**: WHEN an Admin creates an account with the required email, full name, phone number, account type and initial role assignment, the system SHALL create the account inactive with no usable password, derive an internal username under REQ-EVT-05, record the creating Admin, and send a single-use set-password invitation link to that email.
- **REQ-EVT-16**: WHEN an invited user consumes a valid invitation within 24 hours and submits a policy-compliant password, the system SHALL store the password hash, consume the invitation and activate the account without a separate email-verification step.
- **REQ-EVT-17**: WHEN an Admin resends an invitation for an inactive account that has not completed invitation setup, the system SHALL invalidate earlier invitations and send one new single-use invitation.
- **REQ-EVT-18**: WHEN an Admin deactivates another active account and the change retains at least one active account holding `ADMIN`, the system SHALL set `isActive` to false, advance `User.tokenVersion`, and revoke all refresh-token families in the same transaction so issued access tokens fail on their next authenticated request.
- **REQ-EVT-19**: WHEN an Admin reactivates an inactive account, including an account that holds the `ADMIN` role, the system SHALL set `isActive` to true and preserve its account type, roles, profile and existing password.
- **REQ-EVT-20**: WHEN a deactivate request targets an inactive account or a reactivate request targets an active account, the system SHALL return 200 with the current account state and SHALL make no additional state change.
- **REQ-EVT-21**: WHEN TK-22 changes an account's role or active status, or creates an account or resends an invitation, the auth module SHALL emit `audit.record` with the actor, action, subject and redacted before and after values for the platform audit sink.
- **REQ-EVT-22**: WHEN an Admin performs a TK-22 operation in the UI, the app SHALL refresh the affected account detail and list data and show the server-provided outcome without exposing sensitive fields.

### State-Driven

- **REQ-STA-01**: WHILE an account has reached the configured failed-login threshold within the configured window, the system SHALL reject further logins for the configured lockout period with the same response as a wrong password, and audit `auth.login.locked`.
- **REQ-STA-02**: WHILE an account is inactive, soft-deleted or unverified, the system SHALL refuse login and refresh.
- **REQ-STA-03**: WHILE a Guide holds an active assignment to a trip, the system SHALL include that trip id in the Guide's scope; the scope SHALL be re-evaluated on every request, so an unassigned Guide loses access on their next call.

### Unwanted Behaviour

- **REQ-ERR-01**: IF the identifier does not exist or the password is wrong, THEN the system SHALL return 401 `INVALID_CREDENTIALS` with one message for both cases, and SHALL audit `auth.login.failure` with the attempted identifier.
- **REQ-ERR-02**: IF a refresh token that has already been rotated is presented again, THEN the system SHALL treat it as theft, revoke the whole family, audit `auth.refresh.reuse_detected`, and return 401 `REFRESH_TOKEN_REUSED`. [US-005]
- **REQ-ERR-03**: IF an OTP is wrong, expired or already consumed, THEN the system SHALL return 400 `OTP_INVALID` and increment the attempt count; IF attempts reach the configured maximum, THEN the code SHALL be invalidated.
- **REQ-ERR-04**: IF a password fails the policy (length and character classes), THEN the system SHALL return 400 `PASSWORD_POLICY_VIOLATION` naming the unmet rule.
- **REQ-ERR-05**: IF a username or case-insensitive email is already held by an active, inactive or soft-deleted account, THEN the system SHALL return 409 `USERNAME_TAKEN` or `EMAIL_TAKEN`.
- **REQ-ERR-06**: IF a Staff-triggered reset targets an account with no registered email, THEN the system SHALL return 409 `NO_REGISTERED_EMAIL` and send nothing. `[Q35]` *(How such a Customer recovers access is open, QUESTION C-003.)*
- **REQ-ERR-07**: IF a Guide requests any resource outside their trip scope, THEN the system SHALL return 404 `NOT_FOUND`, never 403, so the existence of another trip's data is not disclosed. [E04-5]
- **REQ-ERR-08**: IF an Admin attempts to deactivate their own account, THEN the system SHALL return 403 `FORBIDDEN` and leave the account unchanged; IF a role change or deactivation would leave zero active accounts holding `ADMIN`, THEN the system SHALL return 409 `LAST_ADMIN` and leave the account unchanged, with the guard evaluated inside the same transaction as the write.
- **REQ-ERR-09**: IF an OTP is requested again before the configured cooldown elapses, THEN the system SHALL return 429 `OTP_COOLDOWN`.
- **REQ-ERR-10**: IF a TK-22 detail, role, deactivate or reactivate operation targets an unknown or soft-deleted account id, THEN the system SHALL return 404 `ACCOUNT_NOT_FOUND`.
- **REQ-ERR-11**: IF account creation or role assignment supplies an unknown role or a role incompatible with the account type, THEN the system SHALL return 400 `INVALID_ROLE` and SHALL leave the account unchanged.
- **REQ-ERR-12**: IF `createdFrom` or `createdTo` is not a valid ISO-8601 UTC timestamp, or `createdFrom` is after `createdTo`, THEN the system SHALL return 400 `INVALID_DATE_RANGE`.
- **REQ-ERR-14**: IF an invitation token is unknown, expired, superseded or already consumed, THEN the system SHALL return 400 `INVITATION_INVALID` and SHALL leave the account inactive.
- **REQ-ERR-15**: IF the platform audit sink fails after a TK-22 operation succeeds, THEN the system SHALL log the audit failure and SHALL NOT roll back or fail the completed account operation. [platform REQ-ERR-06]
- **REQ-ERR-16**: IF TK-22 account creation omits email, full name, phone number, account type or its required initial role assignment, or supplies a malformed value, THEN the system SHALL return 400 `VALIDATION_ERROR` and SHALL create no account.

### Optional Features

- **REQ-OPT-01**: WHERE `AUTH_GOOGLE_ENABLED` is true, the system SHALL let a visitor sign in with Google, create a `CUSTOMER` account with a verified email on first sign-in, and derive the username per REQ-EVT-05. `[Q31]`
- **REQ-OPT-02**: WHERE `MAIL_TRANSPORT` is `console`, the system SHALL write outbound OTP emails to the server log instead of sending them, for local development and CI only; the backend SHALL refuse to start with `console` when `NODE_ENV=production`.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Login latency | ≤300 ms p95 at 50 concurrent users, bcrypt cost included | NFR-PERF-01 |
| Password storage | bcrypt, cost from `BCRYPT_COST`, default 12 | NFR-SEC-02 |
| Authorization | server-side only; a hidden button is not access control | NFR-SEC-03 |
| Enumeration resistance | login failure and reset request responses identical for existing and unknown identifiers | REQ-ERR-01, REQ-EVT-07 |
| TK-22 unit verification | Every service success path, authorization rule, validation branch, idempotent status request, token revocation and transaction rollback path has a passing unit test | TK-22 constraint |
| Admin UI accessibility | Keyboard operation, visible focus, labelled controls, programmatic validation messages and WCAG 2.1 AA contrast | NFR-USE-03, frontend conventions |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable |
|---|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | required | env, secret | no |
| `JWT_ACCESS_TTL` | `15m` | env | no |
| `JWT_REFRESH_TTL` | `7d` | env | no |
| `BCRYPT_COST` | 12 | env | no |
| `MAIL_TRANSPORT` | `console` in dev, `smtp` otherwise | env | no |
| `MAIL_FROM` | `treklink.team@gmail.com`, the team's sending account for demo and shared environments | env | no |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Gmail SMTP for `treklink.team@gmail.com`; the password is an app password held in the deployment secrets, never committed | env | no |
| `AUTH_GOOGLE_ENABLED` | `false` | env | no |
| `auth.passwordMinLength` | 8 | DB | yes |
| `auth.loginMaxFailures` | 5 | DB | yes |
| `auth.loginFailureWindowMinutes` | 15 | DB | yes |
| `auth.lockoutMinutes` | 15 | DB | yes |
| `auth.otpTtlMinutes` | 10 | DB | yes |
| `auth.otpMaxAttempts` | 5 | DB | yes |
| `auth.otpResendCooldownSeconds` | 60 | DB | yes |
| `auth.invitationTtlHours` | 24 | DB | yes |

The 24-hour invitation lifetime is confirmed for TK-22. Other defaults retain their existing auth-specification status and remain subject to their cited clarification decisions.

---

## 5. Acceptance Criteria

- **AC-01**: `admin` logs in with the seeded password and receives an access token that expires after `JWT_ACCESS_TTL` and a refresh token.
- **AC-02**: Presenting a refresh token twice revokes the family: the second call and every later refresh in that family return 401 `REFRESH_TOKEN_REUSED`.
- **AC-03**: A Guide assigned to trip A requesting `GET /api/trips/{B}` receives 404; after being assigned to B the same call returns 200 without logging in again.
- **AC-04**: Six wrong passwords in a row lock the account; the sixth and a seventh correct attempt both return the same 401 until the lockout ends.
- **AC-05**: Self-registration without a username for `name123@mail.com` yields username `name123`; the account cannot log in until the OTP is verified.
- **AC-06**: An Operator triggers a reset for a customer; the response contains no code; the console mail transport shows the code sent to the registered email only.
- **AC-07**: Every mutating route in the application is covered by a test that calls it without a token (401) and with a token lacking the permission (403 or scoped 404). A route with neither guard fails the test that enumerates routes from the Nest router.
- **AC-08**: Admin adds a `MANAGER` Staff sub-role with read-only permissions through the API; a user granted it can read bookings and cannot confirm them, with no deployment.
- **AC-09**: An Admin cannot acknowledge an incident unless the same Staff account also holds the `OPERATOR` role.
- **AC-10**: An Admin lists accounts with `page=1&limit=20`, combines role, active-status, search and creation-date filters, and receives newest non-deleted accounts first with shared pagination metadata.
- **AC-11**: An Admin creates a Customer account with the `CUSTOMER` role or a Staff account with one or more Staff sub-roles using email, full name, phone number, account type and initial role assignment; the account remains inactive until its single-use 24-hour invitation is consumed.
- **AC-12**: Creating an account with an email that differs only by letter case from an active, inactive or soft-deleted account returns 409 `EMAIL_TAKEN`.
- **AC-13**: Changing any account to a valid complete role set succeeds when at least one active account retains `ADMIN`; the operation revokes every refresh-token family and makes every issued access token for the changed account fail on its next authenticated request.
- **AC-14**: Deactivating another account succeeds when at least one active account retains `ADMIN`; the operation changes its status and revokes its refresh and access-token sessions atomically, and repeating the request returns 200 with the same inactive state.
- **AC-15**: Reactivating an inactive account preserves its account type, roles, profile and password; repeating the request returns 200 with the same active state.
- **AC-16**: An Admin cannot deactivate their own account. An Admin may change their own role set, or change or deactivate another active Admin, when at least one active account retains `ADMIN`; an inactive Admin can be reactivated by an active Admin.
- **AC-17**: TK-22 responses never expose `passwordHash`, invitation tokens, refresh tokens or reset codes, and every success and failure uses the D-002 envelope.
- **AC-18**: Every TK-22 mutation emits a redacted platform audit event containing the actor, action, subject and before and after values; an audit-sink failure is logged without reversing the mutation.
- **AC-19**: The Admin UI supports listing, viewing, creating, role-changing, deactivating and reactivating accounts with keyboard-accessible controls and loading, empty, validation, success and failure states.

---

## 6. Open Questions

TK-22 has no open domain questions after the story-owner clarification on 2026-09-29. Google OAuth remains optional and outside TK-22. Requirements, design, endpoint contracts and the final task checklist remain subject to the leader's approval on the specification PR before implementation begins.
