# Requirements Specification: auth

**User Story**: As **any TrekLink user**, I want to sign in once with my username and receive exactly the access my role allows, and as an **Admin**, I want to manage accounts, roles and permissions as data, so that a Guide sees only their own trips, a Customer only their own bookings, and a new Staff sub-role needs no code change.
**Story IDs**: US-001 to US-010 (E1) | **Priority**: High | **Main Flow**: MF-01 (prerequisite of every flow) | **Owner of the flow**: TanNB (MF-01); story owners per backlog

> **Authority**: D-002 (envelope), D-015 (configuration), D-024 (prose). Clarification answers **Q30 to Q46** in `07-clarification-answers.md` §3 are **Recorded, not Confirmed**. Every requirement that rests on one is tagged `[Qnn]` and is listed for re-confirmation in QUESTION entry C-003. Nothing here should be built on an unconfirmed answer before that entry is answered.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Accounts with **username as the primary identifier**; email optional and linkable `[Q41]`
  - Two account types, **Customer** and **Staff**; Staff carries one or more sub-roles **Operator, Guide, Admin**, extensible as data `[Q33]`
  - Self-registration by email OTP (Flow 1) and Staff- or Guide-provisioned Customer accounts (Flow 2) `[Q30, Q31]`
  - JWT access tokens, rotating refresh tokens with reuse detection, logout and revocation `[Q34]` (US-003, US-005, US-006)
  - Password policy, lockout, password reset by email OTP, Staff-triggered reset that never reveals the password `[Q35]` (US-007)
  - Data-driven RBAC: roles, permissions and CASL conditions stored as rows, loaded per request (US-001, US-008) `[Q43]`
  - Guide profile: skills, certifications, languages (US-010) `[Q33]`
  - Account status `isActive` and soft delete `[Q36, Q45]`
  - Authentication audit: login success and failure, logout, token reuse, reset, role change (US-004) `[Q46]`
- **Out-of-Scope**:
  - Multi-tenancy; there is one tenant `[Q32]`
  - Google OAuth sign-in: specified as an **optional feature** (REQ-OPT-01) behind a flag, not in the Phase B build unless the approval names it
  - SMS OTP, social logins other than Google, MFA for Staff
  - Identity documents of any kind (NFR-LEG-02)
- **Depends on**: `platform` (envelope, parameters, audit sink, email adapter). Nothing else. Every other module depends on this one for `JwtAuthGuard`, `PoliciesGuard` and `@CurrentUser()`.

### Traceability

| Requirement group | MF | UC | FR | BR | Story |
|---|---|---|---|---|---|
| Sign in, tokens, logout | all | UC-21 | FR-AUTH-02 (new) | | US-003, US-005, US-006 |
| Every mutating endpoint guarded | all | | FR-AUTH-01 | BR-14 | US-008 |
| Guide sees own trip only | MF-03, MF-04 | UC-14 | FR-AUTH-03 | BR-13 | US-008 |
| Registration | MF-01 | UC-27 Register Account (new) | FR-AUTH-04 (new) | | US-002 |
| Password reset | | UC-28 Reset Password (new) | FR-AUTH-05 (new) | | US-007 |
| User and role administration | | UC-18 | FR-AUTH-06, FR-AUTH-07 (new) | | US-001, US-009 |
| Auth audit | | UC-20 | FR-AUTH-08 (new) | | US-004 |
| Guide profile | MF-01 | | FR-AUTH-09 (new) | | US-010 |

"New" FR and UC identifiers are proposed additions to the SRS; REQUEST entry C-004 lists them.

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL identify every account by a unique, case-insensitive `username` of 3 to 32 characters from `[a-z0-9._-]`. `[Q41]`
- **REQ-UBI-02**: The system SHALL store passwords only as bcrypt hashes with the configured cost, and SHALL never persist, log or return a plaintext password. [NFR-SEC-02]
- **REQ-UBI-03**: The system SHALL store refresh tokens, OTP codes and reset codes only as hashes.
- **REQ-UBI-04**: The system SHALL give every account exactly one `accountType`: `CUSTOMER` accounts hold only the `CUSTOMER` role; `STAFF` accounts hold one or more of the Staff sub-roles. `[Q33]`
- **REQ-UBI-05**: The system SHALL resolve a user's permissions from the union of the permission rows of all their roles, and SHALL evaluate every CASL condition server-side. [NFR-SEC-03]
- **REQ-UBI-06**: The system SHALL protect every mutating endpoint in every module with both `JwtAuthGuard` and a `PoliciesGuard` check declared on the handler. [FR-AUTH-01, BR-14, NFR-SEC-01]
- **REQ-UBI-07**: The system SHALL scope every Guide read of trips, devices, rentals, incidents and live positions to the trips the Guide is currently assigned to. [FR-AUTH-03, BR-13] `[Q44]`
- **REQ-UBI-08**: The system SHALL NOT let Admin perform operational actions (acknowledging incidents, confirming bookings, checking devices in or out) by virtue of the Admin role; Admin generalises Staff for **read** access only. [`06-requirements-foundation.md` §2]
- **REQ-UBI-09**: The system SHALL soft-delete accounts (`deletedAt`), never hard-delete them, and SHALL keep them resolvable in audit trails. `[Q36]`

### Event-Driven

- **REQ-EVT-01**: WHEN a user submits a valid identifier (username or email) and password for an active account, the system SHALL issue an access token and a refresh token, record `lastLoginAt`, and audit `auth.login.success`. [UC-21, US-003]
- **REQ-EVT-02**: WHEN a refresh token is presented that is valid and not revoked, the system SHALL revoke it, issue a new access and refresh token pair in the same token family, and link the old token to its replacement. [US-005]
- **REQ-EVT-03**: WHEN a user logs out, the system SHALL revoke the presented refresh token's entire family and audit `auth.logout`. [US-006]
- **REQ-EVT-04**: WHEN a visitor self-registers with a username, email, password, full name and optional phone, the system SHALL create an inactive `CUSTOMER` account, send a verification OTP to the email, and activate the account only when the OTP is verified. [Flow 1, US-002] `[Q31]`
- **REQ-EVT-05**: WHEN a self-registration omits a username, the system SHALL derive one from the email local part, lower-cased and stripped to the allowed alphabet, appending the smallest numeric suffix that makes it unique (`name123@mail.com` becomes `name123`, then `name1231`). `[Q41]`
- **REQ-EVT-06**: WHEN an Operator, Admin or Guide provisions a Customer account (Flow 2), the system SHALL create it active, record `createdById`, and, IF an email is given, send a set-password OTP to that email. `[Q31]`
- **REQ-EVT-07**: WHEN a password reset is requested for an identifier, the system SHALL send a reset OTP to the account's registered email if one exists, and SHALL return the same success response whether or not the identifier exists. [US-007] `[Q35]`
- **REQ-EVT-08**: WHEN a valid reset OTP and a policy-compliant new password are submitted, the system SHALL set the new hash, revoke every refresh token of the account, and audit `auth.password.reset`.
- **REQ-EVT-09**: WHEN Staff triggers a reset for a Customer, the system SHALL send the reset OTP **only** to the email already registered on the account and SHALL NOT return the code, a temporary password or any credential to the Staff member. `[Q35]`
- **REQ-EVT-10**: WHEN an Admin changes a user's roles or a role's permissions, the system SHALL apply the change to that user's next request, revoke the affected users' refresh-token families, and audit the before and after role sets. [US-001, US-009]
- **REQ-EVT-11**: WHEN an account is deactivated or soft-deleted, the system SHALL revoke all its refresh tokens, and access tokens already issued SHALL stop working within the access-token lifetime at most.

### State-Driven

- **REQ-STA-01**: WHILE an account has reached the configured failed-login threshold within the configured window, the system SHALL reject further logins for the configured lockout period with the same response as a wrong password, and audit `auth.login.locked`.
- **REQ-STA-02**: WHILE an account is inactive, soft-deleted or unverified, the system SHALL refuse login and refresh.
- **REQ-STA-03**: WHILE a Guide holds an active assignment to a trip, the system SHALL include that trip id in the Guide's scope; the scope SHALL be re-evaluated on every request, so an unassigned Guide loses access on their next call.

### Unwanted Behaviour

- **REQ-ERR-01**: IF the identifier does not exist or the password is wrong, THEN the system SHALL return 401 `INVALID_CREDENTIALS` with one message for both cases, and SHALL audit `auth.login.failure` with the attempted identifier.
- **REQ-ERR-02**: IF a refresh token that has already been rotated is presented again, THEN the system SHALL treat it as theft, revoke the whole family, audit `auth.refresh.reuse_detected`, and return 401 `REFRESH_TOKEN_REUSED`. [US-005]
- **REQ-ERR-03**: IF an OTP is wrong, expired or already consumed, THEN the system SHALL return 400 `OTP_INVALID` and increment the attempt count; IF attempts reach the configured maximum, THEN the code SHALL be invalidated.
- **REQ-ERR-04**: IF a password fails the policy (length and character classes), THEN the system SHALL return 400 `PASSWORD_POLICY_VIOLATION` naming the unmet rule.
- **REQ-ERR-05**: IF a username or email is already taken, THEN the system SHALL return 409 `USERNAME_TAKEN` or `EMAIL_TAKEN`.
- **REQ-ERR-06**: IF a Staff-triggered reset targets an account with no registered email, THEN the system SHALL return 409 `NO_REGISTERED_EMAIL` and send nothing. `[Q35]` *(How such a Customer recovers access is open, QUESTION C-003.)*
- **REQ-ERR-07**: IF a Guide requests any resource outside their trip scope, THEN the system SHALL return 404 `NOT_FOUND`, never 403, so the existence of another trip's data is not disclosed. [E04-5]
- **REQ-ERR-08**: IF an Admin attempts to remove the last active Admin role assignment in the system, THEN the system SHALL return 409 `LAST_ADMIN`.
- **REQ-ERR-09**: IF an OTP is requested again before the configured cooldown elapses, THEN the system SHALL return 429 `OTP_COOLDOWN`.

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

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable |
|---|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | required | env, secret | no |
| `JWT_ACCESS_TTL` | `15m` | env | no |
| `JWT_REFRESH_TTL` | `7d` | env | no |
| `BCRYPT_COST` | 12 | env | no |
| `MAIL_TRANSPORT` | `console` in dev, `smtp` otherwise | env | no |
| `AUTH_GOOGLE_ENABLED` | `false` | env | no |
| `auth.passwordMinLength` | 8 | DB | yes |
| `auth.loginMaxFailures` | 5 | DB | yes |
| `auth.loginFailureWindowMinutes` | 15 | DB | yes |
| `auth.lockoutMinutes` | 15 | DB | yes |
| `auth.otpTtlMinutes` | 10 | DB | yes |
| `auth.otpMaxAttempts` | 5 | DB | yes |
| `auth.otpResendCooldownSeconds` | 60 | DB | yes |

Every default above is a **proposal** except where a Q answer fixed it; none of Q30 to Q46 gave a number, so all are proposals, justified as common practice for a staff-facing web application.

---

## 5. Acceptance Criteria

- **AC-01**: `admin` logs in with the seeded password and receives an access token that expires after `JWT_ACCESS_TTL` and a refresh token.
- **AC-02**: Presenting a refresh token twice revokes the family: the second call and every later refresh in that family return 401 `REFRESH_TOKEN_REUSED`.
- **AC-03**: A Guide assigned to trip A requesting `GET /api/trips/{B}` receives 404; after being assigned to B the same call returns 200 without logging in again.
- **AC-04**: Six wrong passwords in a row lock the account; the sixth and a seventh correct attempt both return the same 401 until the lockout ends.
- **AC-05**: Self-registration without a username for `name123@mail.com` yields username `name123`; the account cannot log in until the OTP is verified.
- **AC-06**: An Operator triggers a reset for a customer; the response contains no code; the console mail transport shows the code sent to the registered email only.
- **AC-07**: Every mutating route in the application is covered by a test that calls it without a token (401) and with a token lacking the permission (403 or scoped 404). A route with neither guard fails the test that enumerates routes from the Nest router.
- **AC-08**: Admin adds a `MANAGER` role with read-only permissions through the API; a user granted it can read bookings and cannot confirm them, with no deployment.
- **AC-09**: An Admin cannot acknowledge an incident unless they also hold the Operator role.

---

## 6. Open Questions

Carried into QUESTION entry C-003, numbered there: re-confirmation of Q30 to Q46, Google OAuth in or out of Phase B, the recovery path for a Customer with no email, the email provider, and whether a Staff member may hold both Staff and Customer roles.
