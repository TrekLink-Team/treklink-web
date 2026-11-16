# Requirements Specification: auth (identity, sessions, roles and organization scoping)

**User Story**: As a **TrekLink Staff member, an Org Manager or an Org Operator**, I want to sign in with my email, keep a session that is safe to leave open on a phone, and see only what my role and my organization allow, so that tenants never see each other's devices, incidents or money.
**Story ID**: the Stories row of `tasks.md` (backlog D-051) | **Priority**: High | **Milestone**: foundation, with `platform`

> **Authority**: Report 3 SRS (2026-10-14; traceability checked 2026-10-19) UC-08 to UC-10, FR-AUTH-01 to FR-AUTH-11, BR-19, BR-20, BR-35, NFR-SEC-01 to NFR-SEC-03, NFR-SEC-08, Table 78 (screen authorization); D-033 (organizations), D-036 (rewrite).
>
> Rewritten 2026-10-04. The booking-scope suite identified accounts by username and had Customer and Guide roles; both are gone. Requirement identifiers are **renumbered**; `tasks.md` maps the open branches `feat/TK-20-password-reset` and `feat/TK-22-admin-manage-user-account` onto the new ones.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Accounts of two types: `TREKLINK` (roles `ADMIN`, `STAFF`) and `ORGANIZATION` (roles `ORG_MANAGER`, `ORG_OPERATOR`)
  - Sign-in by email and password; short-lived access token; rotating refresh token with reuse detection
  - Password reset by emailed code; invitation codes that set the first password; Staff-triggered reset
  - Data-driven roles and permissions (CASL), changed at run time
  - Per-organization role policy (proposal, D-095): an Org Manager narrows or, for the Operator, widens what the two organization roles may do inside their own organization, within a ceiling that TrekLink sets (§2, REQ-UBI-10 to REQ-UBI-12)
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
| Per-organization role policy (proposal) | FR-AUTH-06, FR-AUTH-10, FR-AUTH-11, FR-ORG-04, D-095; the new functional requirement it needs is an open point (§6) |
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
- **REQ-UBI-10** (proposal, D-095): The system SHALL resolve the permissions of an organization account from the baseline rows of its role, the grants and revokes that its organization stored for that role, and, for `ORG_MANAGER`, the baseline permissions of `ORG_OPERATOR` (REQ-UBI-05), never the grants and revokes the organization stored for `ORG_OPERATOR`, and SHALL intersect the result with the ceiling. The ceiling of `ORG_OPERATOR` and of `ORG_MANAGER` is the set of permissions that the `ORG_MANAGER` role holds in `role_permissions`. [FR-AUTH-06, FR-AUTH-10]
- **REQ-UBI-11** (proposal, D-095): The system SHALL store an organization's grants and revokes only for the roles `ORG_MANAGER` and `ORG_OPERATOR`, only for permissions of account type `ORGANIZATION` (D-057 rule 2), and never as a change to a condition: an `own` condition keeps binding to the caller's own organization (REQ-UBI-06). A grant SHALL name a permission that the baseline of the role lacks and the ceiling holds, SHALL be allowed for `ORG_OPERATOR` only, and SHALL NOT name a `protected` permission; a revoke SHALL name a permission that the baseline holds. [FR-AUTH-11]
- **REQ-UBI-12** (proposal, D-095): The system SHALL keep `organizationRole.manage.own` in the effective permissions of `ORG_MANAGER` of every organization, so an organization cannot lock its own Managers out of the screen that restores access. [FR-AUTH-10]

### Event-Driven

- **REQ-EVT-01**: WHEN valid credentials of an active, unlocked account are submitted, the system SHALL issue an access token (lifetime `JWT_ACCESS_TTL`) carrying `sub`, `accountType`, `roles`, `organizationId` and `memberRole`, and an opaque refresh token in a new family (lifetime `JWT_REFRESH_TTL`). [FR-AUTH-02]
- **REQ-EVT-02**: WHEN a valid refresh token is presented, the system SHALL revoke it, issue a new access and refresh token in the same family, and re-read roles and organization membership. [FR-AUTH-03]
- **REQ-EVT-03**: WHEN a user signs out, the system SHALL revoke the presented refresh token immediately. [FR-AUTH-04]
- **REQ-EVT-04**: WHEN a password reset is requested, the system SHALL email a single-use six-digit code valid for `auth.resetCodeTtlMinutes` to the account's own email, and SHALL answer identically whether or not the email exists. WHEN the active account has never set a password, the code SHALL be a `SET_PASSWORD` code valid for `auth.invitationTtlHours`, which renews an expired invitation (D-059 rule 6). [FR-AUTH-05]
- **REQ-EVT-05**: WHEN a valid code and a policy-compliant password are submitted, the system SHALL set the hash, consume the code and revoke every refresh token of the account.
- **REQ-EVT-06**: WHEN an account is created by an Admin (TrekLink) or through `organizations` (members, the registering Manager), the system SHALL create it without a password and email a `SET_PASSWORD` code valid for `auth.invitationTtlHours`; WHEN the code is used with a compliant password, the system SHALL set it and sign the user in.
- **REQ-EVT-07**: WHEN an account is deactivated, the system SHALL reject its refresh tokens immediately and its access tokens at their next policy check. [FR-AUTH-07]
- **REQ-EVT-08**: WHEN an Admin replaces a role's permissions, the change SHALL apply to every holder on the next request, without a redeploy. [FR-AUTH-06]
- **REQ-EVT-09**: WHEN a request carries `X-Api-Key`, `ApiKeyGuard` SHALL hash it, resolve it through the `API_KEY_RESOLVER` port that `organizations` provides, and authenticate the request as that organization with read-only permissions; the key's `lastUsedAt` SHALL be updated at most once a minute. [FR-ORG-06, BR-20]
- **REQ-EVT-10** (proposal, D-095): WHEN a Manager of an `ACTIVE` organization replaces the permissions of `ORG_MANAGER` or `ORG_OPERATOR` of that organization (`PUT /api/organization/roles/:roleKey/permissions`), the system SHALL compare the sent set with the baseline, store the difference as grants and revokes in one transaction, compare and set the `version` of that organization's policy for the role, drop the cached rules of that organization, and record the granted and revoked keys in the audit log; the change SHALL apply to every member who holds the role from the next request, and no session SHALL end. [FR-AUTH-06, REQ-EVT-08]
- **REQ-EVT-11** (proposal, D-095): WHEN an Admin replaces the permissions of a role (REQ-EVT-08), the system SHALL apply the new baseline and ceiling to every organization from the next request; a stored revoke of a permission the new baseline lacks, and a stored grant outside the new ceiling, SHALL stay stored and SHALL be ignored.

### State-Driven

- **REQ-STA-01**: WHILE an account has reached `auth.loginMaxFailures` failures inside `auth.loginFailureWindowMinutes`, the system SHALL refuse sign-in for `auth.lockoutMinutes`.
- **REQ-STA-02**: WHILE an account is inactive, soft-deleted, or has no password yet, the system SHALL refuse sign-in and refresh.
- **REQ-STA-03**: WHILE an organization member's organization is `CLOSED` or `REJECTED`, the system SHALL refuse sign-in and refresh for that member; a `PENDING` or `SUSPENDED` organization's members SHALL still sign in, with what the organization's state permits. [FR-ORG-01, FR-ORG-07]
- **REQ-STA-04** (proposal, D-095): WHILE an organization is `PENDING` or `SUSPENDED`, the system SHALL let its Manager read the role permissions and SHALL refuse a save with 409 `ORGANIZATION_NOT_ACTIVE`; a `CLOSED` or `REJECTED` organization has no signed-in member (REQ-STA-03), and its stored grants and revokes SHALL stay for the record.

### Unwanted Behaviour

- **REQ-ERR-01**: IF the email is unknown, the password wrong, or the member's organization `CLOSED` or `REJECTED`, THEN the system SHALL return 401 `INVALID_CREDENTIALS` with one message for all of them (MSG09, D-059 rule 2).
- **REQ-ERR-02**: IF a rotated refresh token is presented again, THEN the system SHALL revoke the whole family, record `TOKEN_REUSE_DETECTED`, and return 401 `REFRESH_REUSED`. [FR-AUTH-03]
- **REQ-ERR-03**: IF a code is wrong, expired, consumed, or past `auth.codeMaxAttempts`, THEN the system SHALL return 400 `CODE_INVALID` (MSG08) and count the attempt.
- **REQ-ERR-04**: IF a password is shorter than `auth.passwordMinLength`, THEN the system SHALL return 400 `PASSWORD_POLICY`.
- **REQ-ERR-05**: IF an email is already held by any account, THEN the system SHALL return 409 `CONFLICT_UNIQUE` (MSG10).
- **REQ-ERR-06**: IF an organization member or API key asks for a record of another organization, THEN the system SHALL return 404 `NOT_FOUND`, never 403 (`platform` design §4.2). [E04-4]
- **REQ-ERR-07**: IF an Admin would remove the last active `ADMIN` (deactivation, role change) or their own Admin role, THEN the system SHALL refuse with 409 `LAST_ADMIN` or `SELF_DEMOTION`.
- **REQ-ERR-08**: IF a code is requested again before `auth.codeResendCooldownSeconds`, THEN the system SHALL send no code; a Staff-triggered reset SHALL return 429 `OTP_COOLDOWN`, and a forgot request SHALL answer as usual, so the cooldown cannot reveal a registered email (D-063 rules 2 and 7).
- **REQ-ERR-09**: IF a permission set sent for a role contains a permission whose account type differs from the role's, THEN the system SHALL refuse the whole set with 400 `PERMISSION_SCOPE_MISMATCH` and leave the role unchanged. [FR-AUTH-06, D-057]
- **REQ-ERR-10** (proposal, D-095): IF a save would remove `organizationRole.manage.own` from `ORG_MANAGER`, THEN the system SHALL return 409 `MANAGER_LOCKOUT` and change nothing.
- **REQ-ERR-11** (proposal, D-095): IF a save names a permission outside the ceiling, or of account type `TREKLINK`, or a grant for `ORG_MANAGER`, or a grant of a `protected` permission, THEN the system SHALL refuse the whole set with 400 `PERMISSION_OUT_OF_CEILING` and leave the policy unchanged; a key not in the catalog is 400 `UNKNOWN_PERMISSION` as for REQ-ERR-09.
- **REQ-ERR-12** (proposal, D-095): IF the `expectedVersion` of a save differs from the stored `version` of that organization's policy for the role, THEN the system SHALL return 409 `STALE_VERSION` (MSG36) and change nothing.

### Optional Features

- **REQ-OPT-01**: WHERE `MAIL_TRANSPORT` is `console`, the system SHALL write outbound email to the server log instead of sending it, for local development and CI; WHERE `NODE_ENV` is `production`, the system SHALL refuse to start with the `console` transport (D-063 rule 4). WHERE `MAIL_TRANSPORT` is `smtp`, the system SHALL send through `SMTP_URL` from `MAIL_FROM`.

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
`JWT_REFRESH_SECRET` (optional, reserved and unused: the refresh token is opaque, D-060 rule 6),
`BCRYPT_COST` (default 12), `MAIL_TRANSPORT` (`smtp` or `console`), `MAIL_FROM`, `SMTP_URL`.
Permissions: the generated [Permission Matrix](permission-matrix.md).

---

## 5. Acceptance Criteria

- **AC-01**: An Org Operator of organization A requests `GET /api/incidents/{id}` of an incident of organization B and gets 404; the same id with a TrekLink Staff token gets 200. (TC-19)
- **AC-02**: Presenting a refresh token twice revokes the family; the second refresh and every later one get 401.
- **AC-03**: An Admin removes `incident.respond.own` from `ORG_OPERATOR`; the operator's next acknowledge gets 403 without a restart.
- **AC-04**: A deactivated member's refresh fails at once; their next mutating request gets 401.
- **AC-05**: An API key calls `POST /api/incidents/{id}/acknowledge` and gets 403; `GET /api/telemetry/devices` with it gets 200. (TC-20)
- **AC-06**: Staff trigger a reset for an Org Manager; the code goes to the Manager's email and no response or log contains a password or code. The `console` transport of REQ-OPT-01 is exempt, and never runs in production (D-063 rule 4). (TC-35)
- **AC-07** (proposal): A Manager of organization A removes `incident.respond.own` from `ORG_OPERATOR`; an Operator of A gets 403 on the next acknowledge without signing in again, and an Operator of organization B still gets 200.
- **AC-08** (proposal): A Manager of A sends a set for `ORG_MANAGER` without `organizationRole.manage.own` and gets 409 `MANAGER_LOCKOUT`; a set for `ORG_OPERATOR` that holds a `TREKLINK` permission gets 400 `PERMISSION_OUT_OF_CEILING`.
- **AC-09** (proposal): An Admin removes a permission from the global `ORG_MANAGER`; the grant of that permission stored for `ORG_OPERATOR` of organization B stays stored and stops applying on the next request.
- **AC-10** (proposal): A Manager of organization A removes `incident.respond.own` from `ORG_OPERATOR`; the Manager still gets 200 on acknowledge, because `ORG_MANAGER` takes the baseline of `ORG_OPERATOR` (REQ-UBI-10), and an Operator of A gets 403.

---

## 6. Open Questions

Only for the proposal of D-095 (REQ-UBI-10 to REQ-UBI-12, REQ-EVT-10 and REQ-EVT-11, REQ-STA-04, REQ-ERR-10 to REQ-ERR-12). The leader ruled on them in the review of treklink-web#310 (D-095 amendment, treklink-docs#156); each point keeps its text with the ruling in front.

- **OQ-01** (ruled, changed): An Operator revoke never reaches the Manager. Inheritance (REQ-UBI-05) takes the TrekLink baseline of `ORG_OPERATOR`, not the organization's changes to it, so unticking a box in the Operator column cannot take the permission from the Manager who unticked it (AC-10). The proposal had the opposite rule.
- **OQ-02** (ruled, agreed): Organization API keys carry their own permission keys (task 4.3) and are not narrowed by a revoke. The proposal leaves keys out of this round.
- **OQ-03** (ruled, agreed): The ceiling is one global set (the permissions of `ORG_MANAGER`), not a set per organization. A per-organization ceiling set by Staff is not proposed.
- **OQ-04** (ruled): The SRS has no functional requirement for this screen. No SRS or Report 3 edit now, because the graded reports change only for a resubmission. The citations FR-AUTH-06, FR-AUTH-10, FR-AUTH-11 and FR-ORG-04 stay; FR-AUTH-12, "Manage the role permissions of an organization", is listed for the resubmission in the BM04 scope file.
- **OQ-06** (ruled, agreed): A `protected` permission (`organizationRole.manage.own`) cannot be granted to `ORG_OPERATOR`, so a Manager cannot hand over role management. The alternative is to allow it, which the ceiling would permit.
- **OQ-05** (ruled, agreed): The proposal adds `organizationRole.manage.own` (Manager, protected) and `organizationRole.read` (Admin and Staff) to the catalog, and `auth.permissionCacheTtlSeconds` to the parameters (design 9.4). The keys, the parameter and their migration land with the build; `scripts/specs/catalog.py` and the seed are not changed in this pull request.
