# Technical Design: organizations

> Fulfills `requirements.md` in this folder. Schema: the `// @module organizations` block of
> `backend/prisma/schema.prisma` is authoritative.
>
> **Status**: Approved, written by KhoaDD and merged on `dev` (treklink-web PR #30 and #31, 2026-10-18). Changes go through a pull request reviewed by KhoaDD (D-052).

---

## 1. Data model

```mermaid
erDiagram
    ORGANIZATION ||--|{ ORGANIZATION_MEMBER : "has"
    ORGANIZATION ||--o{ ORGANIZATION_TRANSITION : "history"
    ORGANIZATION ||--o{ ROSTER_SHIFT : "rosters"
    ORGANIZATION_MEMBER |o--o{ ROSTER_SHIFT : "primary or backup"
    ORGANIZATION ||--o{ API_KEY : "owns"
    ORGANIZATION ||--o{ FIELD_STATION : "owns"
    ORGANIZATION {
        uuid id PK
        string code UK
        string taxCode UK
        enum status
        int channelKeyVersion
        int version
    }
    ROSTER_SHIFT {
        uuid id PK
        datetime startsAt
        datetime endsAt
    }
```

***Figure 1***: organizations slice. `OrganizationMember.userId` is unique: one account, one organization.

`code` is `ORG-` plus a zero-padded sequence. `channelKeyVersion` is the version of the organization's
channel key that Staff write to its devices at handover (FR-DEV-05); the key itself lives only in the
counter's provisioning tool and never in the platform (D-021, NFR-SEC-06). Rotating it is a TrekLink
procedure that bumps the version; devices on running contracts keep the version they were given.

---

## 2. Organization lifecycle (D-035)

```mermaid
stateDiagram-v2
    [*] --> PENDING : registered
    PENDING --> ACTIVE : verified and approved
    PENDING --> REJECTED : rejected
    ACTIVE --> SUSPENDED : contract defaulted, or Admin
    SUSPENDED --> ACTIVE : reactivated, nothing due and unpaid
    ACTIVE --> CLOSED : closed, no open contract
    REJECTED --> [*]
    CLOSED --> [*]
```

***Figure 2***: Organization lifecycle. Verification is a recorded fact on a `PENDING` organization, not a
state, matching SRS Figure 28.

| From | To | Who | Guard |
|---|---|---|---|
| (none) | `PENDING` | Guest | unique tax code and Manager email |
| `PENDING` | `ACTIVE` | Admin | `verifiedAt` set |
| `PENDING` | `REJECTED` | Admin | reason |
| `ACTIVE` | `SUSPENDED` | Admin, or `SYSTEM` from `rentals` on default | reason |
| `SUSPENDED` | `ACTIVE` | Admin | every `ORGANIZATION_EXIT_CHECKS.canReactivate(orgId, tx, at)` reports nothing; billing counts only lines due and unpaid at `at` (leader ruling 2026-10-30) |
| `ACTIVE` | `CLOSED` | Admin | every `ORGANIZATION_EXIT_CHECKS.canClose(orgId)` true |

Each transition is a compare-and-set on `version` plus one `OrganizationTransition` row in one
transaction.

---

## 3. Roster and on-duty resolution

A shift is `[startsAt, endsAt)` with an optional primary and an optional backup; the database rejects
overlaps (`roster_shifts_no_overlap`). `RosterService.tiersAt(orgId, instant)` returns:

```typescript
{ primary?: MemberContact; backup?: MemberContact; managers: MemberContact[] }
```

Only active members are returned. `incidents` calls it once when an incident is routed and again at
each tier step, so a roster edit applies to the next tier, never to an alert already sent (BR-16). A
window with no shift, or a shift with no primary, is the `NO_PRIMARY` warning; alerting then starts at
the backup tier, or at the Managers when there is no backup (D-034).

---

## 4. Keys and Field Station credentials

| | API key | Field Station credential |
|---|---|---|
| Created by | Org Manager | Org Manager (D-037) |
| Revoked by | Org Manager | Org Manager, TrekLink Staff, Admin |
| Revoke reason | not applicable, no `reason` field | required when `caller.organizationId` is null (TrekLink Staff, Admin); optional for the organization's own Manager; not re-checked when the station is already revoked (api-design 25) |
| Listed by | Org Manager: own; TrekLink Staff, Admin: any organization, read only (api-design 20, ruling 2026-10-30) | Org Manager, Org Operator: own; TrekLink Staff, Admin (api-design 23) |
| Limit | `organizations.maxApiKeys`, returned as `limit` by the list; 409 `KEY_LIMIT` on create | `organizations.maxFieldStations`, returned as `limit` by the list; 409 `STATION_LIMIT` on create |
| Secret | `tlk_` + 43 base64url chars; SHA-256 stored; prefix of 8 shown | `fs_` + 43 base64url chars; bcrypt stored |
| Identity | the hash | `mqttUsername` = `fs-<org code lower-case>-<n>` |
| Used by | `ApiKeyGuard` via `API_KEY_RESOLVER` | the broker's go-auth hook via `gateway-sync` |
| Health | `lastUsedAt` | `lastSyncAt`, `queueDepth` (stored `Int[]`, index = priority; returned as `{p0, p1, p2, p3}`, D-057 rule 9), `oldestRetryCount`, `version`, written by `gateway-sync` through `recordStationHealth()`; `outdated` is computed on read against the current release |

The Field Station is updated by download (D-039 (b)). `FieldStationReleaseService.current()` reads
`release.json` from `FIELD_STATION_RELEASE_DIR`, caches it until the file changes, and compares versions
by semantic-version order. There is no update push, release endpoint on the station, or self-replace.

SHA-256 for API keys keeps the per-request lookup an index hit; bcrypt for station secrets suits a
check made once per MQTT connection.

---

## 4.1 Contract terms and compliance cases (D-046)

Verification records `ndaSigned` and `softwareLicenceSigned`; both must be true (BR-43), because the
Field Station's code and the firmware are in the customer's hands. A `ComplianceCase` records a suspected
fraud, theft, IP violation, NDA breach or other breach. Actions taken from it reuse the existing
operations, suspension (`OrganizationsService.suspend`) and revocation of Field Station credentials and
API keys, and each is appended as a `ComplianceAction`. A `SUSPECTED_FRAUD` or `SUSPECTED_THEFT` case
closes only with a police report reference (BR-40), enforced by the service and by the
`compliance_cases_police_reference_to_close` CHECK. A loss case flagged as suspected theft opens a case,
or links to the organization's open case of the same type.

`channelKeyExposedAt` is set by `markKeyExposed` when a device in the organization's custody is lost
(D-045) and cleared when Staff record a key rotation. The platform cannot change a key on a device it
cannot reach, so rotation takes effect device by device at the counter. `markKeyExposed` runs in the
caller's transaction and is idempotent: while the flag is set it keeps the first time and does not tell
the Managers again. After the commit the live Managers with an active account are emailed, or the
contact address given at registration when none can be reached.

---

## 5. Services and ports

| Export | Used by | Purpose |
|---|---|---|
| `OrganizationsService.assertActive(orgId)` | rentals | FR-CON-02 |
| `OrganizationsService.suspendForDefault(orgId, contractCode, tx)` | rentals | FR-ORG-07 |
| `OrganizationsService.channelKeyVersion(orgId)` | rentals | provisioning |
| `RosterService.tiersAt(orgId, instant)` | incidents | routing and tiers |
| `FieldStationsService.byUsername(username)`, with the secret hash | gateway-sync | broker hook |
| `FieldStationsService.stationByUsername(username)`, without the secret hash | gateway-sync | Stage C ingestion, station health report |
| `FieldStationsService.recordStationHealth(id, health)` | gateway-sync | FR-EVT-13 |
| `ChannelKeyService.markKeyExposed(orgId, at, actor, tx)` | devices | FR-DEV-13, D-045 |
| `ComplianceCaseService.openOrLink(orgId, lossCaseId, actor, tx)` | devices | FR-DEV-13, D-046 |
| provider of `ACCOUNT_CONTEXT_PROVIDER`, `API_KEY_RESOLVER` | auth | `platform` design §2.1 |

Declares `ORGANIZATION_EXIT_CHECKS` (multi): `{ canReactivate(orgId, tx, at): Promise<Reason | null>; canClose(orgId, tx): Promise<Reason | null> }`; `at` is the reactivation time.

Declares `ORGANIZATION_COUNTS` (multi): `{ name: 'runningContracts' | 'openIncidents'; count(orgId): Promise<number> }`, for the counts of api-design 03. Provided by `rentals` (`runningContracts`: ACTIVE, ENDING, RETURN_DUE or OVERDUE) and `incidents` (`openIncidents`: not CLOSED); a count with no provider is reported as 0.

Events emitted: `member.deactivated`, `apiKey.revoked`, `fieldStation.revoked`, `organization.statusChanged` (with the reason), `organization.registered`, `organization.verified`, `audit.record`. `OnboardingNotifier` listens to `organization.registered`, `organization.verified` and `organization.statusChanged`: it tells Staff and Admin of a registration and of the first verification through `STAFF_NOTIFICATIONS`, and emails the Manager MSG05 or MSG16 when a `PENDING` organization is approved or rejected.

---

## 6. Error catalogue

| Code | HTTP |
|---|---|
| `NOT_VERIFIED` | 409 |
| `LAST_MANAGER` | 409 |
| `BALANCE_OUTSTANDING` | 409 |
| `OPEN_CONTRACTS` | 409 |
| `SHIFT_OVERLAP` | 409 |
| `SHIFT_STARTED` | 409 (deleting a shift that has started, api-design 19; changing any field but `endsAt` of one, api-design 18. An `endsAt` before now on a started shift is 400 `VALIDATION_FAILED`) |
| `MEMBER_NOT_ELIGIBLE` | 400 |
| `KEY_LIMIT` | 409 |
| `STATION_LIMIT` | 409 |
| `ORGANIZATION_NOT_ACTIVE` | 409 (raised for `rentals` by `assertActive`) |
| `CONTRACT_TERMS_MISSING` | 400 (verification without the NDA or the software licence, BR-43) |
| `POLICE_REFERENCE_REQUIRED` | 409 (closing a suspected fraud or theft case without an authority reference, BR-40) |

---

## 7. Sequence: registration to approval

```mermaid
sequenceDiagram
    autonumber
    actor G as Guest
    actor S as TrekLink Staff
    actor A as TrekLink Admin
    participant O as OrganizationsService
    participant Au as AccountsService
    participant DB as Postgres
    G->>O: register(company, manager)
    O->>DB: BEGIN, INSERT organization PENDING, transition
    O->>Au: createOrganizationAccount(manager, MANAGER, tx)
    O->>DB: INSERT member, COMMIT
    O-)G: invitation email (MSG04 on screen)
    S->>O: verify(id, documents, masterContractRef)
    O-)A: notify: awaiting approval
    A->>O: approve(id)
    O->>DB: UPDATE ACTIVE WHERE version, INSERT transition
    O-)G: MSG05 email to the Manager
```

***Figure 3***: MF-01 onboarding.

---

## 8. Testing strategy

Lifecycle matrix unit test (every pair, allowed or 409); overlap and member-eligibility tests against
Postgres; key and station hashing; last-Manager under concurrency; cross-organization 404 on every route.

---

## 9. Detailed design for Report 4 (D-044)

Layering for every module (D-044): a page calls a controller over HTTPS; the controller checks the JWT
and the policy, then calls a service; the service owns the transaction and calls the module's
repository, the only class that touches Prisma; other modules are reached only through their exported
services. Figures 4 and 10 are the class views of this module, core and
compliance cases; Figures 5 to 9 and 11 are the MF-01, MF-02 and MF-05 interactions it owns.

<!-- sdd: MF-01 class organizations -->
```mermaid
classDiagram
    class OrganizationsController {
        +register(dto) OrganizationDto
        +verify(id, dto, actor) OrganizationDto
        +approve(id, dto, actor) OrganizationDto
    }
    class FieldStationsController {
        +list(orgId, caller) StationDto[]
        +create(orgId, dto, actor) StationSecretDto
        +revoke(orgId, stationId, dto, actor) StationDto
        +release(orgId) ReleaseDto
    }
    class ChannelKeyController {
        +rotate(id, dto, staff) RotatedKeyDto
    }
    class OrganizationsService {
        +register(dto) Organization
        +verify(id, dto, actor) Organization
        +approve(id, dto, actor) Organization
        +assertActive(orgId)
        +suspendForDefault(orgId, contractCode, tx)
    }
    class ChannelKeyService {
        +markKeyExposed(orgId, at, actor, tx)
        +rotate(id, reason, expectedVersion, staff)
    }
    class RosterService {
        +tiersAt(orgId, instant) Tiers
    }
    class FieldStationsService {
        +create(orgId, dto, actor) StationSecret
        +byUsername(username) StationCredential
        +stationByUsername(username) StationIdentity
        +recordStationHealth(id, health)
    }
    class FieldStationReleaseService {
        +current() Release
        +isOutdated(version) bool
    }
    class OrganizationsRepository {
        +insertPending(data, tx) Organization
        +transition(id, from, to, version, reason, tx)
    }
    class FieldStationsRepository {
        +insert(data, tx) FieldStation
        +findByUsername(username) FieldStation
        +updateHealth(id, health)
    }
    class AccountsService
    OrganizationsController --> OrganizationsService
    ChannelKeyController --> ChannelKeyService
    FieldStationsController --> FieldStationsService
    FieldStationsController --> FieldStationReleaseService
    OrganizationsService --> OrganizationsRepository
    ChannelKeyService --> OrganizationsRepository
    OrganizationsService --> AccountsService : auth module
    RosterService --> OrganizationsRepository
    FieldStationsService --> FieldStationsRepository
    FieldStationsService --> FieldStationReleaseService
```

***Figure 4***: organizations classes. `AccountsService` belongs to `auth`.

<!-- sdd: MF-01 seq UC-01 -->
```mermaid
sequenceDiagram
    autonumber
    actor G as Guest
    participant P as RegisterPage
    participant C as OrganizationsController
    participant S as OrganizationsService
    participant R as OrganizationsRepository
    participant A as AccountsService
    G->>P: company, tax code, Manager contact
    P->>C: POST /api/organizations/register
    C->>S: register(dto)
    S->>R: existsTaxCodeOrEmail(taxCode, email)
    alt refused: already registered
        S-->>C: 409 DUPLICATE
        C-->>P: failure envelope, MSG10
    else accepted: new organization
        S->>R: insertPending(dto, tx)
        R->>R: INSERT organization PENDING and transition
        S->>A: createOrganizationAccount(manager, MANAGER, tx)
        S->>S: COMMIT, then SET_PASSWORD code and Staff notice
        S-->>C: OrganizationDto PENDING
        C-->>P: 201 envelope
        P-->>G: MSG04 next steps
    end
```

***Figure 5***: UC-01 Register Organization.

<!-- sdd: MF-01 seq UC-02 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as OrganizationReviewPage
    participant C as OrganizationsController
    participant S as OrganizationsService
    participant R as OrganizationsRepository
    St->>P: documents seen, master contract reference
    P->>C: POST /api/organizations/{id}/verification
    C->>S: verify(id, dto, actor)
    S->>R: setVerification(id, dto, actor)
    R->>R: UPDATE verifiedAt WHERE status PENDING
    S->>S: notify Staff and Admin, audit.record
    S-->>C: OrganizationDto
    C-->>P: 200 envelope
```

***Figure 6***: UC-02 Verify Organization.

<!-- sdd: MF-01 seq UC-03 -->
```mermaid
sequenceDiagram
    autonumber
    actor Ad as TrekLink Admin
    participant P as OrganizationReviewPage
    participant C as OrganizationsController
    participant S as OrganizationsService
    participant R as OrganizationsRepository
    Ad->>P: approve
    P->>C: POST /api/organizations/{id}/approve
    C->>S: approve(id, dto, actor)
    S->>R: findById(id)
    alt refused: not verified
        S-->>C: 409 NOT_VERIFIED
        C-->>P: failure envelope
    else accepted: verified
        S->>R: transition(id, PENDING, ACTIVE, version, tx)
        R->>R: UPDATE WHERE version, INSERT transition
        S->>S: MSG05 email to the Manager, audit.record
        S-->>C: OrganizationDto ACTIVE
        C-->>P: 200 envelope
    end
```

***Figure 7***: UC-03 Approve Organization.

<!-- sdd: MF-02 seq UC-06 part 1 of 2: credential and download -->
```mermaid
sequenceDiagram
    autonumber
    actor M as Org Manager
    participant P as FieldStationsPage
    participant C as FieldStationsController
    participant S as FieldStationsService
    participant V as FieldStationReleaseService
    participant R as FieldStationsRepository
    M->>P: create a station named Ta Nang laptop
    P->>C: POST /api/organizations/{id}/field-stations
    C->>S: create(orgId, dto, actor)
    S->>R: countActive(orgId)
    alt refused: limit reached
        S-->>C: 409 STATION_LIMIT
    else accepted: below the limit
        S->>S: username fs-org-n, 32 random bytes, bcrypt hash
        S->>R: insert(station, tx)
        S-->>C: username and secret, shown once
        C-->>P: 201 envelope
        M->>P: download the Field Station
        P->>C: GET /api/organizations/{id}/field-stations/release
        C->>V: current()
        V-->>C: version, files with SHA-256
        C-->>P: 200 envelope, download link
    end
```

***Figure 8***: UC-06 for a Field Station, part 1 of 2: credential and download (FR-EVT-18).

<!-- sdd: MF-02 seq UC-06 part 2 of 2: broker check -->
```mermaid
sequenceDiagram
    autonumber
    participant FS as Field Station
    participant B as Mosquitto go-auth
    participant C as BrokerAuthController
    participant H as BrokerAuthService
    participant S as FieldStationsService
    participant R as FieldStationsRepository
    FS->>B: CONNECT username, secret
    B->>C: POST /api/internal/mqtt/user
    C->>H: checkUser(dto)
    H->>H: verify X-Broker-Secret
    H->>S: byUsername(username)
    S->>R: findByUsername(username)
    H->>H: revoked check, bcrypt.compare
    H-->>C: allow or deny
    C-->>B: 200 or 403
    B-->>FS: CONNACK accepted or refused
```

***Figure 9***: UC-06 for a Field Station, part 2 of 2: the broker's credential check.

<!-- sdd: MF-05 class organizations-compliance -->
```mermaid
classDiagram
    class ComplianceCasesController {
        +open(orgId, dto, actor) CaseDto
        +act(id, dto, actor) CaseDto
        +close(id, dto, actor) CaseDto
    }
    class ComplianceCaseService {
        +open(orgId, dto, actor) ComplianceCase
        +openOrLink(orgId, lossCaseId, actor, tx)
        +act(id, dto, actor) ComplianceCase
        +close(id, dto, actor) ComplianceCase
    }
    class ComplianceCasesRepository {
        +insert(row, tx) ComplianceCase
        +appendAction(row, tx)
        +setClosed(id, outcome, reference, tx)
    }
    class OrganizationsService
    class FieldStationsService
    class ApiKeysService
    class LossCaseService
    ComplianceCasesController --> ComplianceCaseService
    ComplianceCaseService --> ComplianceCasesRepository
    ComplianceCaseService --> OrganizationsService : suspend
    ComplianceCaseService --> FieldStationsService : revoke
    ComplianceCaseService --> ApiKeysService : revoke
    LossCaseService --> ComplianceCaseService : openOrLink
```

***Figure 10***: organizations classes for compliance cases (D-046). `LossCaseService` belongs to `devices`.

<!-- sdd: MF-05 seq UC-63 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    actor Ad as TrekLink Admin
    participant P as ComplianceCasePage
    participant C as ComplianceCasesController
    participant S as ComplianceCaseService
    participant O as OrganizationsService
    participant R as ComplianceCasesRepository
    St->>P: open SUSPECTED_THEFT with evidence
    P->>C: POST /api/organizations/{id}/compliance-cases
    C->>S: open(orgId, dto, actor)
    S->>R: insert(case OPEN, links, tx)
    Ad->>P: suspend the organization
    P->>C: POST /api/compliance-cases/{id}/actions
    C->>S: act(id, SUSPEND_ORGANIZATION, actor)
    S->>O: suspend(orgId, reason, actor, tx)
    S->>R: appendAction(row, tx)
    St->>P: close with outcome
    P->>C: POST /api/compliance-cases/{id}/close
    C->>S: close(id, dto, actor)
    alt refused: no police reference for suspected theft or fraud
        S-->>C: 409 POLICE_REFERENCE_REQUIRED
    else accepted: reference present or not required
        S->>R: setClosed(id, outcome, authorityReference, tx)
        C-->>P: 200 envelope
    end
```

***Figure 11***: UC-63 Handle Compliance Case (BR-40, D-046).
