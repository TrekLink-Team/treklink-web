# Requirements Specification: platform (cross-cutting backend foundation)

**User Story**: As a **member of the TrekLink team building any backend module**, I want one response envelope, one error catalogue, one validated configuration source, one audit sink and one runtime business-parameter store, so that every module behaves the same way at its boundary and no module reinvents them.
**Story ID**: US-077 (health), US-079 (configuration matrix), US-004 (audit sink, shared with `auth`) | **Priority**: High | **Milestone**: Phase B foundation, before any MF-01 module code

> **Authority**: D-001 (Prisma), D-002 (envelope), D-010 (Neon and local Docker Postgres), D-015 (business parameters are configuration), D-024 (prose). Conventions `04-architecture-conventions.md`, `05-backend-conventions.md`.
>
> **Why this spec exists.** The prompt lists eight business modules plus `gateway-sync`. The envelope interceptor, the exception filter, validated env configuration, the Admin-editable parameter store (UC-19) and the audit-log viewer (UC-20) belong to none of them, yet every one of them depends on all five. Writing them into `auth` would make every module import `auth` for reasons unrelated to identity. This spec is **proposed** as a tenth spec folder and a `backend/src/modules/platform/` module; see QUESTION entry C-003.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - The D-002 envelope on every HTTP response, success and failure, including paged collections
  - The error-code catalogue shape and the rule that every business failure carries a stable code
  - Environment configuration: typed, validated at boot, fail-fast on a missing or malformed value
  - Database selection by environment only: local Docker Postgres for tests and CI, Neon for shared dev and demo (D-010)
  - Runtime business parameters editable by Admin (UC-19, FR-ADM-02), with append-only change history
  - A generic append-only audit log fed by domain events from every module (UC-20, US-004, Q46 "audit everything")
  - Liveness and readiness endpoint (US-077)
  - Shared pagination, sorting and filtering contract
  - Shared scheduler host for time-triggered rules (reservation expiry, staleness, escalation), so the Scheduler actor of `06-requirements-foundation.md` §2 has one implementation
- **Out-of-Scope**:
  - Identity, tokens, roles and CASL policy definitions, owned by `auth`
  - Module-specific audit trails with their own semantics (`IncidentAudit`, `DeviceStatusHistory`, `SyncAuditLog`), owned by their modules. The generic log here complements them.
  - Deployment, Docker images and CD (E7, cross-cutting, not a Main Flow)
- **Depends on**: nothing. Every other module depends on this one.

### Traceability

| This spec | SRS / project artefact |
|---|---|
| Envelope, error catalogue | D-002, `05-backend-conventions.md` §3, §4 |
| Parameter store | UC-19 Configure Business Parameters, NFR-CFG-01, NFR-CFG-02, BR-23 |
| Audit log | UC-20 View Audit Log, NFR-SEC-04, US-004 |
| Health | US-077 |
| Configuration | D-010, D-015, NFR-SEC-05 |
| Module isolation | NFR-MNT-01 |

New FR identifiers proposed here (the SRS draft names no `FR-ADM-*` rows yet): **FR-ADM-01** audit log, **FR-ADM-02** business parameters, **FR-ADM-03** health.

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL return every HTTP response body in the shape `{ "result", "isSuccess", "statusCode", "message" }` and SHALL NOT add, remove or rename a top-level key. [D-002]
- **REQ-UBI-02**: The system SHALL set the envelope `statusCode` equal to the HTTP status of the response.
- **REQ-UBI-03**: The system SHALL return paged collections as `result = { items, pageNumber, pageSize, totalCount, totalPages }`, with `pageNumber` 1-based. [`05-backend-conventions.md` §3.2]
- **REQ-UBI-04**: The system SHALL identify every business failure with a stable UPPER_SNAKE error code drawn from a single catalogue, and SHALL carry it in the failure envelope as `result = { "errorCode": "<CODE>" }`. *(Proposal: keeps the four-key shape of D-002 while giving the frontend a machine-readable code. The alternative, `result: null` with the code only in `message`, forces string parsing. See QUESTION C-003.)*
- **REQ-UBI-05**: The system SHALL store every timestamp in UTC and SHALL serialise it as ISO 8601 with a `Z` suffix.
- **REQ-UBI-06**: The system SHALL read no business parameter from a source literal. Each SHALL come from validated environment configuration or from the runtime parameter store. [D-015, NFR-CFG-01]
- **REQ-UBI-07**: The system SHALL write every entry of the generic audit log append-only. No update or delete path SHALL exist in application code, and the database SHALL reject `UPDATE` and `DELETE` on the table. [NFR-SEC-04]
- **REQ-UBI-08**: The system SHALL assign every request a correlation id, return it in the `X-Request-Id` response header, and include it in every log line and every 500 log entry.
- **REQ-UBI-09**: The system SHALL never serialise a password hash, token hash, OTP hash, channel PSK or any secret into a response, a log line or an audit entry. [NFR-SEC-02, NFR-SEC-05]

### Event-Driven

- **REQ-EVT-01**: WHEN the process starts, the system SHALL validate every required environment variable against a typed schema and SHALL refuse to start, naming each invalid variable, IF any is missing or malformed.
- **REQ-EVT-02**: WHEN a module emits an `audit.record` domain event, the system SHALL persist one audit entry with actor id, actor roles, action, subject type, subject id, a redacted before and after snapshot, request correlation id and UTC timestamp.
- **REQ-EVT-03**: WHEN an Admin updates a business parameter, the system SHALL validate the new value against the parameter's declared type and bounds, persist it, append a history row with the previous value, the new value, the actor and the timestamp, and make the new value visible to every reader within the configured cache TTL. [UC-19]
- **REQ-EVT-04**: WHEN `GET /api/health` is called, the system SHALL report process liveness, database reachability and MQTT broker reachability, and SHALL return 503 if the database is unreachable. [US-077]
- **REQ-EVT-05**: WHEN a scheduled job fires, the system SHALL run it on a single instance at a time, record its start, outcome and duration, and SHALL NOT let one failed job stop the scheduler.

### State-Driven

- **REQ-STA-01**: WHILE `NODE_ENV` is `test`, the system SHALL connect only to the database named by `DATABASE_URL`, which CI points at the ephemeral Docker Postgres service. No code path SHALL select a database by anything other than environment variables. [D-010]
- **REQ-STA-02**: WHILE a parameter is being read inside a transaction, the system SHALL use the value current at transaction start for the whole transaction, so one operation never mixes two values of the same parameter.

### Unwanted Behaviour

- **REQ-ERR-01**: IF a request body fails DTO validation, THEN the system SHALL return 400 with `errorCode = VALIDATION_FAILED` and a `message` naming each offending property. [`05-backend-conventions.md` §2 rule 2]
- **REQ-ERR-02**: IF an unhandled exception escapes a handler, THEN the system SHALL return 500 with the generic message `Internal server error`, `errorCode = INTERNAL_ERROR`, and log the stack with the correlation id. No stack trace or SQL SHALL reach the client.
- **REQ-ERR-03**: IF a Prisma unique-constraint violation escapes a service, THEN the system SHALL map it to 409 `errorCode = CONFLICT_UNIQUE` naming the field, rather than 500.
- **REQ-ERR-04**: IF a Prisma record-not-found error escapes a service, THEN the system SHALL map it to 404 `errorCode = NOT_FOUND`.
- **REQ-ERR-05**: IF an Admin submits a parameter value outside its declared bounds or of the wrong type, THEN the system SHALL return 400 `errorCode = PARAMETER_OUT_OF_RANGE` and SHALL leave the stored value unchanged.
- **REQ-ERR-06**: IF the audit sink fails to persist an entry, THEN the system SHALL log the failure with the full entry and SHALL NOT roll back or fail the business operation that emitted it. *(Audit loss is logged loudly; it never blocks an SOS acknowledgement.)* Module-specific trails that are part of the business transaction (`IncidentAudit`, `DeviceStatusHistory`) are written inside that transaction and are not subject to this rule.
- **REQ-ERR-07**: IF a request exceeds the configured body size limit, THEN the system SHALL return 413 `errorCode = PAYLOAD_TOO_LARGE`.

### Optional Features

- **REQ-OPT-01**: WHERE `SWAGGER_ENABLED` is true, the system SHALL serve OpenAPI documentation at `/api/docs`, documenting the envelope on every operation.
- **REQ-OPT-02**: The system SHALL require `DATABASE_DIRECT_URL` and Prisma migrations SHALL use it, so that Neon's pooled connection string serves the application and the direct string serves `prisma migrate`. For local Docker Postgres it equals `DATABASE_URL`. *(Leader decision, PR #12: with `directUrl = env("DATABASE_DIRECT_URL")` in the datasource, Prisma 6.19.3 fails every CLI command except `prisma generate` with `P1012` when the variable is unset, so it cannot be optional.)*

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| API latency | ≤300 ms for 95 % of requests at 50 concurrent users | NFR-PERF-01 |
| Envelope conformance | 100 % of endpoints, verified by an e2e test per endpoint | D-002 |
| Parameter change visibility | new value visible to every reader within the cache TTL, default 30 s | UC-19, BR-23 |
| TypeScript | `strict: true` in `backend/tsconfig.json` | `02-spec-driven-development-workflow.md` Phase 5 |

---

## 4. Configuration Matrix entries owned here

Every row is registered in the Configuration Matrix (D-015). Environment rows need a restart; database rows are live.

| Parameter | Default | Location | Admin-editable |
|---|---|---|---|
| `DATABASE_URL` | none, required | env | no |
| `DATABASE_DIRECT_URL` | none, required (equals `DATABASE_URL` locally) | env | no |
| `JWT_*` (owned by `auth`, validated here) | see `auth` | env | no |
| `MQTT_BROKER_URL` | none, required | env | no |
| `CORS_ORIGINS` | `http://localhost:5173` | env | no |
| `HTTP_BODY_LIMIT` | `1mb` | env | no |
| `SWAGGER_ENABLED` | `true` outside production | env | no |
| `PARAMETER_CACHE_TTL_SECONDS` | 30 | env | no |
| `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` | 20 / 100 | env | no |
| `DISPLAY_TIMEZONE_DEFAULT` | `Asia/Ho_Chi_Minh` (UTC+7, Q37) | env | no |

Module parameters are listed in each module's own `requirements.md` §4.

---

## 5. Acceptance Criteria

- **AC-01**: A handler returning `{ a: 1 }` produces `{ "result": { "a": 1 }, "isSuccess": true, "statusCode": 200, "message": "<declared message>" }`.
- **AC-02**: A thrown `ConflictException` with code `DEVICE_NOT_AVAILABLE` produces 409 and `result.errorCode = "DEVICE_NOT_AVAILABLE"`.
- **AC-03**: A malformed body produces 400 `VALIDATION_FAILED` naming the property.
- **AC-04**: Starting the backend with `DATABASE_URL` unset exits non-zero and names the variable.
- **AC-05**: Pointing `DATABASE_URL` at Neon or at local Docker Postgres needs no code change; CI runs against Docker Postgres only.
- **AC-06**: An Admin changes `rentals.customerHoldMinutes` from 10 to 15 through the API; a booking reserved after the TTL gets a 15-minute hold, and the change appears in the parameter history with actor and both values. (The D-015 "change it and show me now" demo.)
- **AC-07**: `UPDATE audit_log SET ...` executed directly in SQL fails with an error raised by the table trigger.
- **AC-08**: `GET /api/health` returns 503 while the database container is stopped and 200 after it restarts.

---

## 6. Open Questions

Carried into QUESTION entry C-003: whether `platform` is accepted as a module, and the failure-envelope `errorCode` placement.
