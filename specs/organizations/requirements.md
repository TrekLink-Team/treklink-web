# Requirements Specification: organizations (tenants, members, roster, keys and Field Station credentials)

**User Story**: As an **Org Manager**, I want to register my company, get it verified, and then manage my own members, on-duty roster, API keys and Field Station credentials, so that my organization rents and operates TrekLink devices without asking TrekLink for routine changes.
**Story ID**: assigned when the backlog is regenerated | **Priority**: High | **Milestone**: MF-01, before rentals

> **Authority**: Report 3 SRS (2026-10-04) UC-01 to UC-07, FR-ORG-01 to FR-ORG-07, FR-EVT-14, BR-01, BR-16, BR-19, BR-20, BR-26, BR-32, MSG04, MSG05, MSG10, MSG16, MSG21, MSG22; D-033 items 2, 6, 7; D-035 (organization lifecycle); D-037 (self-service Field Station credentials). New module (D-036).

---

## 1. Domain Context & Scope

- **In-Scope**: registration, verification, approval or rejection; suspension, reactivation and closing;
  members and their roles; the on-duty roster; API keys; Field Station credentials and their health
  projection; the organization channel key version.
- **Out-of-Scope**: account credentials and sessions (`auth`); contracts (`rentals`); balances
  (`billing`); alert routing itself (`incidents` reads the roster).
- **Depends on**: `platform`, `auth`. Provides the ports `ACCOUNT_CONTEXT_PROVIDER` and
  `API_KEY_RESOLVER` to `auth`; declares `ORGANIZATION_EXIT_CHECKS`, provided by `billing` and `rentals`.

### Traceability

| This spec | SRS |
|---|---|
| Registration, verification, decision | UC-01 to UC-03, FR-ORG-01 to FR-ORG-03, BR-01 |
| Members | UC-04, FR-ORG-04, FR-AUTH-07 |
| Roster | UC-05, FR-ORG-05, BR-16 |
| API keys | UC-06, FR-ORG-06, BR-20 |
| Field Station credentials | UC-06, FR-EVT-14, FR-EVT-13, D-037 |
| Suspension | UC-07, UC-50, FR-ORG-07, BR-26, BR-32 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL change organization status only through the D-035 lifecycle (`PENDING`, `ACTIVE`, `REJECTED`, `SUSPENDED`, `CLOSED`) and SHALL write an append-only transition row with actor or `SYSTEM`, reason and UTC time for each change.
- **REQ-UBI-02**: The system SHALL keep every organization account in exactly one organization and SHALL keep at least one active Manager in every organization that is not `CLOSED` or `REJECTED`. [FR-ORG-04]
- **REQ-UBI-03**: The system SHALL store API keys and Field Station secrets only as hashes, show each once at creation, and never return it again. [FR-ORG-06, FR-EVT-14, NFR-SEC-02]
- **REQ-UBI-04**: The system SHALL keep the shift windows of one organization from overlapping, enforced by the database, and SHALL require a shift's primary and backup to be different active members of that organization. [FR-ORG-05]

### Event-Driven

- **REQ-EVT-01**: WHEN a Guest registers with a tax code and a Manager email not already registered, the system SHALL create the organization `PENDING`, its Manager account and membership in one transaction, email the Manager an invitation, and notify TrekLink Staff. [FR-ORG-01, MSG04]
- **REQ-EVT-02**: WHEN Staff record a verification, the system SHALL store the method, documents seen, master contract reference and verifying Staff member, and SHALL notify Admins. [FR-ORG-02]
- **REQ-EVT-03**: WHEN an Admin approves a verified `PENDING` organization, the system SHALL move it to `ACTIVE` and email the Manager (MSG05); WHEN an Admin rejects it, the system SHALL move it to `REJECTED` with the reason (MSG16). [FR-ORG-03]
- **REQ-EVT-04**: WHEN an Admin suspends an `ACTIVE` organization, or `rentals` reports a defaulted contract, the system SHALL move it to `SUSPENDED` with the reason and notify the Manager. [FR-ORG-07, BR-26]
- **REQ-EVT-05**: WHEN an Admin reactivates a `SUSPENDED` organization and every `ORGANIZATION_EXIT_CHECKS` provider reports nothing outstanding, the system SHALL move it to `ACTIVE`. [FR-ORG-07]
- **REQ-EVT-06**: WHEN an Admin closes an `ACTIVE` organization with no open contract, the system SHALL deactivate its members, revoke its API keys and Field Station credentials, and move it to `CLOSED`.
- **REQ-EVT-07**: WHEN a Manager invites a member, the system SHALL create the organization account through `auth` with the chosen role and email an invitation; WHEN a Manager changes a role or deactivates a member, the system SHALL apply it through `auth` and emit `member.deactivated` for a deactivation. [FR-ORG-04]
- **REQ-EVT-08**: WHEN a member is deactivated, the system SHALL clear that member from every shift that has not ended. [D-034, FR-ORG-05]
- **REQ-EVT-09**: WHEN a Manager creates an API key or a Field Station credential, the system SHALL generate it from at least 32 random bytes, store its hash, and return it once; WHEN a Manager, or for a Field Station also TrekLink Staff or an Admin, revokes one, it SHALL stop authenticating from the next request or connection. [FR-ORG-06, FR-EVT-14, D-037]
- **REQ-EVT-10**: WHEN `incidents` asks for the on-duty tiers of an organization at an instant, the system SHALL return the primary and backup of the shift covering that instant, if any, and the organization's active Managers. [BR-16]

### State-Driven

- **REQ-STA-01**: WHILE an organization is not `ACTIVE`, the system SHALL report it as unable to request contracts (`assertActive`); WHILE it is `SUSPENDED`, the system SHALL still resolve its roster and keys, so its rented devices stay monitored and its incidents routed. [FR-CON-02, BR-32]
- **REQ-STA-02**: WHILE a roster window has no primary, the system SHALL return a `NO_PRIMARY` warning for it (MSG22). [FR-ORG-05]

### Unwanted Behaviour

- **REQ-ERR-01**: IF a registration's tax code or Manager email is already registered, THEN the system SHALL return 409 `CONFLICT_UNIQUE` (MSG10).
- **REQ-ERR-02**: IF an Admin approves an organization with no verification, THEN the system SHALL return 409 `NOT_VERIFIED` (MSG21).
- **REQ-ERR-03**: IF a change would leave no active Manager, THEN the system SHALL return 409 `LAST_MANAGER`.
- **REQ-ERR-04**: IF a reactivation finds an outstanding balance, or a closing an open contract, THEN the system SHALL return 409 `BALANCE_OUTSTANDING` or `OPEN_CONTRACTS`.
- **REQ-ERR-05**: IF a member of organization A addresses organization B's resources, THEN the system SHALL return 404 `NOT_FOUND`. [FR-AUTH-11]
- **REQ-ERR-06**: IF the active API keys or Field Station credentials would exceed `organizations.maxApiKeys` or `organizations.maxFieldStations`, THEN the system SHALL return 409 `KEY_LIMIT` or `STATION_LIMIT`.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Cross-organization denial | every route of this module in `tenancy.e2e-spec.ts` | NFR-SEC-04 |
| Key verification | API key lookup by hash ≤5 ms p95 (unique index) | NFR-PERF-01 |

---

## 4. Configuration

The `organizations` section of the [Configuration Matrix](../platform/configuration-matrix.md).

---

## 5. Acceptance Criteria

- **AC-01**: Register, verify, approve: the Manager signs in after setting a password and can request a contract only after approval. (TC-01)
- **AC-02**: Approving without verification returns 409 `NOT_VERIFIED`.
- **AC-03**: A Manager tries to deactivate themselves while the only Manager: 409 `LAST_MANAGER`.
- **AC-04**: Two overlapping shifts: the second insert fails with 409 `SHIFT_OVERLAP`.
- **AC-05**: A created API key works on `GET /api/telemetry/devices`; after revocation the same call returns 401. (E04-5)
- **AC-06**: A revoked Field Station credential is refused by the broker at its next connection.
- **AC-07**: A suspended organization cannot request a contract (409), while an SOS from one of its rented devices still reaches its primary. (TC-32)

---

## 6. Open Questions

None.
