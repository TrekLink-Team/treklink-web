# Requirements Specification: auth (identity, sessions, roles and organization scoping)

**User Story**: As a **TrekLink Staff member, an Org Manager or an Org Operator**, I want to sign in with my email, keep a session that is safe to leave open on a phone, and see only what my role and my organization allow, so that tenants never see each other's devices, incidents or money.
**Story ID**: assigned when the backlog is regenerated (D-033 consequence) | **Priority**: High | **Milestone**: foundation, with `platform`

> **Authority**: Report 3 SRS (2026-10-04) UC-08 to UC-10, FR-AUTH-01 to FR-AUTH-11, BR-19, BR-20, BR-35, NFR-SEC-01 to NFR-SEC-03, NFR-SEC-08, Table 72 (screen authorization); D-033 (organizations), D-036 (rewrite).
>
> Rewritten 2026-10-04. The booking-scope suite identified accounts by username and had Customer and Guide roles; both are gone. Requirement identifiers are **renumbered**; `tasks.md` maps the open branches `feat/TK-20-password-reset` and `feat/TK-22-admin-manage-user-account` onto the new ones.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Accounts of two types: `TREKLINK` (roles `ADMIN`, `STAFF`) and `ORGANIZATION` (roles `ORG_MANAGER`, `ORG_OPERATOR`)
  - Sign-in by email and password; short-lived access token; rotating refresh token with reuse detection
  - Password reset by emailed code; invitation codes that set the first password; Staff-triggered reset
  - Data-driven roles and permissions (CASL), changed at run time
  - Server-side organization scoping for members and API keys (`ApiKeyGuard` verifies keys that `organizations` issues)
  - TrekLink account administration (UC-10); the authentication audit log
- **Out-of-Scope**:
  - Organization accounts' creation, roles and deactivation: done by the Org Manager through `organizations`, which calls this module's services
  - API key and Field Station credential issuance: `organizations`
  - Google or any third-party sign-in; self-registration of a person (a Guest registers an organization)
- **Depends on**: `platform`. Reads organization membership and API keys through the `ACCOUNT_CONTEXT_PROVIDER` and `API_KEY_RESOLVER` ports that `organizations` provides (`platform` design §2.1).

### Traceability

| This spec | SRS |
|---|---|
| Sign-in, tokens, sign-out | UC-08, FR-AUTH-01 to FR-AUTH-04, FR-AUTH-08 |
| Reset and invitation codes | UC-09, UC-04, UC-10, FR-AUTH-05, BR-35 |
| Roles and permissions | UC-10, FR-AUTH-06, FR-AUTH-07, FR-AUTH-10 |
| Organization scoping | FR-AUTH-11, BR-19, BR-20, NFR-SEC-03, NFR-SEC-04 |
| Soft delete | FR-AUTH-09, NFR-SEC-08 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL identify every account by its email, unique case-insensitively across active, inactive and soft-deleted accounts, and SHALL store it lower-case.
- **REQ-UBI-02**: The system SHALL store passwords only as bcrypt hashes, and refresh tokens and codes only as SHA-256 hashes; it SHALL never persist, log or return a plaintext secret. [NFR-SEC-02]
- **REQ-UBI-03**: The system SHALL give every account exactly one `accountType`; a `TREKLINK` account SHALL hold only `ADMIN` or `STAFF`, and an `ORGANIZATION` account only `ORG_MANAGER` or `ORG_OPERATOR`.
- **REQ-UBI-04**: The system SHALL protect every mutating endpoint with an authentication guard and a `PoliciesGuard` check declared on the handler; an API key SHALL never satisfy a mutating endpoint. [FR-AUTH-01, BR-20, NFR-SEC-01]
- **REQ-UBI-05**: The system SHALL resolve a user's permissions from the union of the role permissions, with `ADMIN` holding every `STAFF` permission and `ORG_MANAGER` every `ORG_OPERATOR` permission. [FR-AUTH-10]
- **REQ-UBI-06**: The system SHALL take the caller's `organizationId` only from the verified access token or API key, never from a path, query or body value, and SHALL bind every `own` CASL condition to it. [FR-AUTH-11, NFR-SEC-03]
- **REQ-UBI-07**: The system SHALL soft-delete accounts and keep them resolvable in audit trails. [FR-AUTH-09, NFR-SEC-08]
- **REQ-UBI-08**: The system SHALL record every authentication event (sign-in success and failure, sign-out, refresh, reuse detection, password set, reset requested and completed, lock, deactivation, reactivation) in the append-only `auth_events` table with actor, type, IP and UTC time, and never the attempted password. [FR-AUTH-08]
- **REQ-UBI-09**: No TrekLink account SHALL be able to read or set another account's password; Staff may only trigger a reset to the account's own email. [FR-AUTH-05, BR-35]

### Event-Driven

- **REQ-EVT-01**: WHEN valid credentials of an active, unlocked account are submitted, the system SHALL issue an access token (lifetime `JWT_ACCESS_TTL`) carrying `sub`, `accountType`, `roles`, `organizationId` and `memberRole`, and an opaque refresh token in a new family (lifetime `JWT_REFRESH_TTL`). [FR-AUTH-02]
- **REQ-EVT-02**: WHEN a valid refresh token is presented, the system SHALL revoke it, issue a new access and refresh token in the same family, and re-read roles and organization membership. [FR-AUTH-03]
- **REQ-EVT-03**: WHEN a user signs out, the system SHALL revoke the presented refresh token immediately. [FR-AUTH-04]
- **REQ-EVT-04**: WHEN a password reset is requested, the system SHALL email a single-use six-digit code valid for `auth.resetCodeTtlMinutes` to the account's own email, and SHALL answer identically whether or not the email exists. [FR-AUTH-05]
- **REQ-EVT-05**: WHEN a valid code and a policy-compliant password are submitted, the system SHALL set the hash, consume the code and revoke every refresh token of the account.
- **REQ-EVT-06**: WHEN an account is created by an Admin (TrekLink) or through `organizations` (members, the registering Manager), the system SHALL create it without a password and email a `SET_PASSWORD` code valid for `auth.invitationTtlHours`; WHEN the code is used with a compliant password, the system SHALL set it and sign the user in.
- **REQ-EVT-07**: WHEN an account is deactivated, the system SHALL reject its refresh tokens immediately and its access tokens at their next policy check. [FR-AUTH-07]
- **REQ-EVT-08**: WHEN an Admin replaces a role's permissions, the change SHALL apply to every holder on the next request, without a redeploy. [FR-AUTH-06]
- **REQ-EVT-09**: WHEN a request carries `X-Api-Key`, `ApiKeyGuard` SHALL hash it, resolve it through the `API_KEY_RESOLVER` port that `organizations` provides, and authenticate the request as that organization with read-only permissions; the key's `lastUsedAt` SHALL be updated at most once a minute. [FR-ORG-06, BR-20]

### State-Driven

- **REQ-STA-01**: WHILE an account has reached `auth.loginMaxFailures` failures inside `auth.loginFailureWindowMinutes`, the system SHALL refuse sign-in for `auth.lockoutMinutes`.
- **REQ-STA-02**: WHILE an account is inactive, soft-deleted, or has no password yet, the system SHALL refuse sign-in and refresh.
- **REQ-STA-03**: WHILE an organization member's organization is `CLOSED` or `REJECTED`, the system SHALL refuse sign-in and refresh for that member; a `PENDING` or `SUSPENDED` organization's members SHALL still sign in, with what the organization's state permits. [FR-ORG-01, FR-ORG-07]

### Unwanted Behaviour

- **REQ-ERR-01**: IF the email is unknown or the password wrong, THEN the system SHALL return 401 `INVALID_CREDENTIALS` with one message for both (MSG09).
- **REQ-ERR-02**: IF a rotated refresh token is presented again, THEN the system SHALL revoke the whole family, record `TOKEN_REUSE_DETECTED`, and return 401 `REFRESH_REUSED`. [FR-AUTH-03]
- **REQ-ERR-03**: IF a code is wrong, expired, consumed, or past `auth.codeMaxAttempts`, THEN the system SHALL return 400 `CODE_INVALID` (MSG08) and count the attempt.
- **REQ-ERR-04**: IF a password is shorter than `auth.passwordMinLength`, THEN the system SHALL return 400 `PASSWORD_POLICY`.
- **REQ-ERR-05**: IF an email is already held by any account, THEN the system SHALL return 409 `CONFLICT_UNIQUE` (MSG10).
- **REQ-ERR-06**: IF an organization member or API key asks for a record of another organization, THEN the system SHALL return 404 `NOT_FOUND`, never 403 (`platform` design §4.2). [E04-4]
- **REQ-ERR-07**: IF an Admin would remove the last active `ADMIN` (deactivation, role change) or their own Admin role, THEN the system SHALL refuse with 409 `LAST_ADMIN` or `SELF_DEMOTION`.
- **REQ-ERR-08**: IF a code is requested again before `auth.codeResendCooldownSeconds`, THEN the system SHALL return 429 `OTP_COOLDOWN`.

### Optional Features

- **REQ-OPT-01**: WHERE `MAIL_TRANSPORT` is `console`, the system SHALL write outbound email to the server log instead of sending it, for local development and CI.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Cross-organization denial | one e2e test per module reading another organization's record by id, expecting 404 | NFR-SEC-04, TC-19 |
| bcrypt cost | `BCRYPT_COST`, default 12 | NFR-SEC-02 |
| Sign-in latency | ≤300 ms p95 excluding bcrypt | NFR-PERF-01 |

---

## 4. Configuration

Business parameters: the `auth` section of the [Configuration Matrix](../platform/configuration-matrix.md).
Environment: `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL` (default `15m`), `JWT_REFRESH_TTL` (default `14d`),
`BCRYPT_COST` (default 12), `MAIL_TRANSPORT` (`smtp` or `console`), `MAIL_FROM`, `SMTP_URL`.
Permissions: the generated [Permission Matrix](permission-matrix.md).

---

## 5. Acceptance Criteria

- **AC-01**: An Org Operator of organization A requests `GET /api/incidents/{id}` of an incident of organization B and gets 404; the same id with a TrekLink Staff token gets 200. (TC-19)
- **AC-02**: Presenting a refresh token twice revokes the family; the second refresh and every later one get 401.
- **AC-03**: An Admin removes `incident.respond.own` from `ORG_OPERATOR`; the operator's next acknowledge gets 403 without a restart.
- **AC-04**: A deactivated member's refresh fails at once; their next mutating request gets 401.
- **AC-05**: An API key calls `POST /api/incidents/{id}/acknowledge` and gets 403; `GET /api/telemetry/devices` with it gets 200. (TC-20)
- **AC-06**: Staff trigger a reset for an Org Manager; the code goes to the Manager's email and no response or log contains a password or code. (TC-35)

---

## 6. Open Questions

None.
