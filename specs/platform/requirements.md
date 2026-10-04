# Requirements Specification: platform (cross-cutting backend foundation)

**User Story**: As a **member of the TrekLink team building any backend module**, I want one response envelope, one error catalogue, one validated configuration source, one audit sink, one runtime business-parameter store and one scheduler host, so that every module behaves the same way at its boundary and no module reinvents them.
**Story ID**: assigned when the backlog is regenerated (D-033 consequence) | **Priority**: High | **Milestone**: foundation, before any MF-01 module code

> **Authority**: Report 3 SRS (2026-10-04) UC-56 to UC-58, FR-CFG-01 to FR-CFG-03, NFR-CFG-01, NFR-CFG-02, NFR-SEC-05, NFR-MNT-01, NFR-AVL-02; D-001 (Prisma), D-002 (envelope), D-010 (databases), D-015 (business parameters are configuration), D-026 (error code in `result`), D-028 (this module), D-032 (MQTT health probe), D-036 (rewrite), D-038 (the SePay webhook exception to D-002). Conventions `04-architecture-conventions.md`, `05-backend-conventions.md`.
>
> Rewritten 2026-10-04 for the enterprise rental platform (D-033). Requirement identifiers are unchanged from the booking-scope suite, because merged code cites them; only their traces and examples changed.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - The D-002 envelope on every HTTP response, success and failure, including paged collections; one named exception (§2, REQ-UBI-01)
  - The error-code catalogue shape and the rule that every business failure carries a stable code
  - Environment configuration: typed, validated at boot, fail-fast on a missing or malformed value
  - Database selection by environment only: local Docker Postgres for tests and CI, Neon for shared dev and demo once provisioned (D-010)
  - Runtime business parameters editable by a TrekLink Admin (UC-57, FR-CFG-01, FR-CFG-02), with append-only change history; the Configuration Matrix generated from the parameter catalogue
  - A generic append-only audit log fed by domain events from every module, scoped by organization (UC-58)
  - Liveness and readiness endpoint
  - Shared pagination, sorting and filtering contract
  - The scheduler host for every time-triggered rule (tier timeouts, staleness, term rollover, overdue and default)
  - The post-commit domain-event helper every module uses
- **Out-of-Scope**:
  - Identity, tokens, roles and CASL policy definitions, owned by `auth`
  - Module trails with their own semantics (`IncidentTransition`, `DeviceTransition`, `ContractTransition`, `OrganizationTransition`, `SyncAuditLog`, `AuthEvent`), owned by their modules. The generic log complements them.
  - Prices and the damage schedule (`billing`); they are configuration too, but versioned per variant
  - Deployment, Docker images and CD (DevOps epic, not a Main Flow)
- **Depends on**: nothing. Every other module depends on this one.

### Traceability

| This spec | SRS / project artefact |
|---|---|
| Envelope, error catalogue | D-002, D-026, D-038, NFR-UI-02, `05-backend-conventions.md` §3, §4 |
| Parameter store, Configuration Matrix | UC-57, FR-CFG-01, FR-CFG-02, NFR-CFG-01, NFR-CFG-02, BR-29 |
| Audit log | UC-58, NFR-SEC-05, BR-18 |
| Health | UC-42, NFR-AVL-01, D-032 |
| Scheduler | NFR-AVL-02, NFR-REL-07 |
| Configuration | D-010, D-015, NFR-SEC-06 |
| Module isolation | NFR-MNT-01 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL return every HTTP response body in the shape `{ "result", "isSuccess", "statusCode", "message" }` and SHALL NOT add, remove or rename a top-level key, except `POST /api/payments/sepay/webhook`, which answers SePay's required body `{ "success": true }` (D-038). [D-002]
- **REQ-UBI-02**: The system SHALL set the envelope `statusCode` equal to the HTTP status of the response.
- **REQ-UBI-03**: The system SHALL return paged collections as `result = { items, pageNumber, pageSize, totalCount, totalPages }`, with `pageNumber` 1-based. [`05-backend-conventions.md` §3.2]
- **REQ-UBI-04**: The system SHALL identify every business failure with a stable UPPER_SNAKE error code drawn from a single catalogue, and SHALL carry it in the failure envelope as `result = { "errorCode": "<CODE>" }`. [D-026]
- **REQ-UBI-05**: The system SHALL store every timestamp in UTC and SHALL serialise it as ISO 8601 with a `Z` suffix. Clients display it in the viewer's timezone, UTC+7 by default (NFR-USE-05).
- **REQ-UBI-06**: The system SHALL read no business parameter or price from a source literal. Each SHALL come from validated environment configuration, the runtime parameter store, or the price tables of `billing`. [D-015, NFR-CFG-01, BR-29]
- **REQ-UBI-07**: The system SHALL write every entry of the generic audit log append-only. No update or delete path SHALL exist in application code, and the database SHALL reject `UPDATE` and `DELETE` on the table. [NFR-SEC-05, BR-18]
- **REQ-UBI-08**: The system SHALL assign every request a correlation id, return it in the `X-Request-Id` response header, and include it in every log line and every 500 log entry.
- **REQ-UBI-09**: The system SHALL never serialise a password hash, token hash, code hash, API key, Field Station secret, channel key or any secret into a response, a log line or an audit entry. [NFR-SEC-02, NFR-SEC-06]
- **REQ-UBI-10**: The system SHALL record on each audit entry the organization the action belongs to, when there is one, so that an organization's own trail can be read without scanning others. [FR-AUTH-11]

### Event-Driven

- **REQ-EVT-01**: WHEN the process starts, the system SHALL validate every required environment variable against a typed schema and SHALL refuse to start, naming each invalid variable, IF any is missing or malformed.
- **REQ-EVT-02**: WHEN a module emits an `audit.record` domain event, the system SHALL persist one audit entry with actor id, actor roles, organization id, action, subject type, subject id, a redacted before and after snapshot, request correlation id and UTC timestamp.
- **REQ-EVT-03**: WHEN a TrekLink Admin updates a business parameter, the system SHALL validate the new value against the parameter's declared type and bounds, persist it, append a history row with the previous value, the new value, the actor, the reason and the timestamp, and make the new value visible to every reader within the configured cache TTL. [UC-57, FR-CFG-02]
- **REQ-EVT-04**: WHEN `GET /api/health` is called, the system SHALL report process liveness, database reachability and MQTT broker reachability, and SHALL return 503 `SERVICE_UNAVAILABLE` if the database is unreachable or does not answer within `HEALTH_DB_TIMEOUT_MS`. MQTT reachability SHALL come from the optional `MQTT_HEALTH_PROBE` and SHALL be reported as `unknown`, without changing `status`, while no probe is registered. [D-032]
- **REQ-EVT-05**: WHEN a scheduled job fires, the system SHALL run it on a single instance at a time, record its start, outcome and duration, and SHALL NOT let one failed job stop the scheduler.
- **REQ-EVT-06**: WHEN the backend restarts, every job SHALL resume from the deadlines stored in the database, so that no pending timeout is lost or doubled. [NFR-AVL-02]

### State-Driven

- **REQ-STA-01**: WHILE `NODE_ENV` is `test`, the system SHALL connect only to the database named by `DATABASE_URL`, which CI points at the ephemeral Docker Postgres service. No code path SHALL select a database by anything other than environment variables. [D-010]
- **REQ-STA-02**: WHILE a parameter is being read inside a transaction, the system SHALL use the value current at transaction start for the whole transaction, so one operation never mixes two values of the same parameter.

### Unwanted Behaviour

- **REQ-ERR-01**: IF a request body or query fails DTO validation, THEN the system SHALL return 400 with `errorCode = VALIDATION_FAILED` and a `message` naming each offending property. [`05-backend-conventions.md` §2 rule 2]
- **REQ-ERR-02**: IF an unhandled exception escapes a handler, THEN the system SHALL return 500 with the generic message `Internal server error`, `errorCode = INTERNAL_ERROR`, and log the stack with the correlation id. No stack trace or SQL SHALL reach the client.
- **REQ-ERR-03**: IF a Prisma unique-constraint violation escapes a service, THEN the system SHALL map it to 409 `errorCode = CONFLICT_UNIQUE` naming the field, rather than 500.
- **REQ-ERR-04**: IF a Prisma record-not-found error escapes a service, THEN the system SHALL map it to 404 `errorCode = NOT_FOUND`.
- **REQ-ERR-05**: IF an Admin submits a parameter value outside its declared bounds or of the wrong type, THEN the system SHALL return 400 `errorCode = PARAMETER_OUT_OF_RANGE` and SHALL leave the stored value unchanged.
- **REQ-ERR-06**: IF the audit sink fails to persist an entry, THEN the system SHALL log the failure with the full entry and SHALL NOT roll back or fail the business operation that emitted it. Module trails that are part of the business transaction (`IncidentTransition`, `DeviceTransition`, `ContractTransition`) are written inside that transaction and are not subject to this rule.
- **REQ-ERR-07**: IF a request exceeds the configured body size limit, THEN the system SHALL return 413 `errorCode = PAYLOAD_TOO_LARGE`. The handover endpoint, which carries a signature image, has its own limit (`rentals` requirements §4).

### Optional Features

- **REQ-OPT-01**: WHERE `SWAGGER_ENABLED` is true, the system SHALL serve OpenAPI documentation at `/api/docs`, documenting the envelope on every operation.
- **REQ-OPT-02**: The system SHALL require `DATABASE_DIRECT_URL` and Prisma migrations SHALL use it, so that Neon's pooled connection string serves the application and the direct string serves `prisma migrate`. For local Docker Postgres it equals `DATABASE_URL`. *(Leader decision, PR #12: with `directUrl = env("DATABASE_DIRECT_URL")` in the datasource, Prisma 6.19.3 fails every CLI command except `prisma generate` with `P1012` when the variable is unset, so it cannot be optional.)*

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| API latency | ≤300 ms for 95 % of requests at 50 concurrent users | NFR-PERF-01 |
| Envelope conformance | 100 % of endpoints except the SePay webhook, verified by an e2e test per endpoint | D-002, D-038 |
| Parameter change visibility | new value visible to every reader within the cache TTL, default 30 s | FR-CFG-01, BR-29 |
| Timer durability | a restarted backend resumes every pending deadline | NFR-AVL-02 |
| TypeScript | `strict: true` in `backend/tsconfig.json` | `02-spec-driven-development-workflow.md` Phase 5 |

---

## 4. Configuration owned here

Environment rows need a restart. Business parameters of every module are in the generated
[Configuration Matrix](configuration-matrix.md) (NFR-CFG-02); `platform` owns the store, not the rows.

| Parameter | Default | Location | Admin-editable |
|---|---|---|---|
| `DATABASE_URL` | none, required | env | no |
| `DATABASE_DIRECT_URL` | none, required (equals `DATABASE_URL` locally) | env | no |
| `JWT_*` (owned by `auth`, validated here) | see `auth` | env | no |
| `MQTT_BROKER_URL` | none, required | env | no |
| `MQTT_AUTH_HOOK_SECRET` | none, required (owned by `gateway-sync`, validated here) | env | no |
| `SEPAY_WEBHOOK_API_KEY` | none, required (owned by `billing`, validated here) | env | no |
| `CORS_ORIGINS` | `http://localhost:5173` | env | no |
| `HTTP_BODY_LIMIT` | `1mb` | env | no |
| `SWAGGER_ENABLED` | `true` outside production | env | no |
| `PARAMETER_CACHE_TTL_SECONDS` | 30 | env | no |
| `HEALTH_DB_TIMEOUT_MS` | 2000; the health endpoint's `SELECT 1` bound (TK-90) | env | no |
| `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` | 20 / 100 | env | no |
| `DISPLAY_TIMEZONE_DEFAULT` | `Asia/Ho_Chi_Minh` (UTC+7) | env | no |

---

## 5. Acceptance Criteria

- **AC-01**: A handler returning `{ a: 1 }` produces `{ "result": { "a": 1 }, "isSuccess": true, "statusCode": 200, "message": "<declared message>" }`.
- **AC-02**: A thrown `DomainException` with code `INSUFFICIENT_DEVICES` produces 409 and `result.errorCode = "INSUFFICIENT_DEVICES"`.
- **AC-03**: A malformed body produces 400 `VALIDATION_FAILED` naming the property.
- **AC-04**: Starting the backend with `DATABASE_URL` unset exits non-zero and names the variable.
- **AC-05**: Pointing `DATABASE_URL` at Neon or at local Docker Postgres needs no code change; CI runs against Docker Postgres only.
- **AC-06**: An Admin changes `incidents.primaryAckTimeoutSeconds` from 120 to 60 through the API; the next incident escalates from the primary tier after 60 s, and the change appears in the parameter history with actor and both values. (The D-015 "change it and show me now" demonstration, BR-29, TC-29.)
- **AC-07**: `UPDATE audit_log SET ...` executed directly in SQL fails with an error raised by the table trigger.
- **AC-08**: `GET /api/health` returns 503 while the database container is stopped and 200 after it restarts.
- **AC-09**: With an incident pending a tier timeout, the backend is restarted; the escalation still happens at the stored deadline, once.

---

## 6. Open Questions

None. D-028 accepted this module; D-026 settled the error-code placement; D-038 the one envelope exception.
