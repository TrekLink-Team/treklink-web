# Implementation Tasks: platform

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6. Tasks marked done were
> merged on `dev` (TK-90 and the D-036 rebaseline) and stay done. Fulfills `design.md`; endpoints are
> `api-design/01` to `05`.

| | |
|---|---|
| Lane owner | KhoaDD (roadmap §5.1) |
| Reviewer | LongLP |
| Sprint | 3 (W7 to W8); every module waits on Phases 1 and 2 |
| Stories | US-UC56 (prices UI is `billing`), US-UC57, US-UC58, US-X01, US-X02 |
| Depends on | nothing |

## Phase 1: Foundation & Domain Modeling

- [x] 1.1 `strict: true` in `backend/tsconfig.json`; scaffold typechecks clean (owner KhoaDD)
- [x] 1.2 `EnvironmentVariables` and `validate()` for `ConfigModule.forRoot`, failing fast and naming each bad variable (owner KhoaDD)
  - _Requirements: REQ-EVT-01, AC-04_
- [x] 1.3 Datasource `url` and `directUrl`; Neon versus Docker selection documented in `.env.example` (owner KhoaDD)
  - _Requirements: REQ-STA-01, REQ-OPT-02, AC-05, D-010_
- [x] 1.4 Prisma models `AuditLog`, `BusinessParameter`, `BusinessParameterHistory`, enum `ParameterType` (owner KhoaDD)
- [x] 1.5 Rebaseline: `schema.prisma` for every module, `constraints.sql`, baseline `20261004120000_initial_schema` (owner KhoaDD)
  - _Requirements: REQ-UBI-07, design §3.4, D-036_
- [x] 1.6 Seed `20261004120100_seed` generated from `scripts/specs/catalog.py` (owner KhoaDD)
  - _Requirements: REQ-UBI-06, FR-AUTH-06, NFR-CFG-02_
- [x] 1.7 Organization id on the audit payload (owner KhoaDD)
  - **Files**: `backend/src/modules/platform/audit/audit-record.event.ts`, `audit-sink.listener.ts`
  - **Do**: add `organizationId: string | null` to `AuditRecordEvent`; the sink writes it to `audit_log.organization_id`. Members drop and recreate their local database once (D-036)
  - **Test**: `audit-sink.listener.spec.ts`: an event with and without `organizationId` persists the column as given
  - _Requirements: REQ-UBI-10, FR-AUTH-11_
  - _Depends on: 2.5_
- [x] 1.8 `common/errors`: `ErrorCode` enum, `DomainException`, cross-cutting codes of design §4.2 (owner KhoaDD)
  - _Requirements: REQ-UBI-04, AC-02_
- [x] 1.9 `PagedQueryDto` and `PagedResult<T>` in `common/dto/paging.ts`, 1-based `pageNumber`, `DEFAULT_PAGE_SIZE` and `MAX_PAGE_SIZE` (owner KhoaDD)
  - _Requirements: REQ-UBI-03_
- [x] 1.10 Module-boundary check `backend/scripts/check-module-boundaries.js` wired into `npm run lint` (owner KhoaDD)
- [x] 1.11 Boundary test for the D-033 module set (owner KhoaDD)
  - **Files**: `backend/src/module-boundaries.spec.ts`, `backend/scripts/check-module-boundaries.js`
  - **Do**: list the nine modules `platform`, `auth`, `organizations`, `devices`, `rentals`, `billing`, `incidents`, `gateway-sync`, `monitoring`; assert each model's `// @module` owner from `schema.prisma`; assert the DI graph of design Figure 3 is acyclic
  - **Test**: the spec itself; it fails when `src/modules/a/` references a model owned by `b`
  - _Requirements: NFR-MNT-01_
- [x] 1.12 Demo seed `backend/prisma/seed-demo.ts` (owner KhoaDD)
  - **Do**: idempotent upserts: one account per role, one `ACTIVE` organization with Manager and Operator, hardware variants v2 to v4 with prices and damage rates, fourteen `AVAILABLE` devices (ten `treklink-v3`), one `ACTIVE` contract; passwords from `SEED_*_PASSWORD`, never committed; no real personal data
  - **Test**: run twice on an empty database after `prisma migrate deploy`; the second run changes nothing
  - **Done when**: `npm run seed:demo` loads the data `api-design/00-api-testing-guide.md` §2 assumes
  - **Done**: CI runs the seed twice on the migrated Postgres 16; the second run uses `--expect-unchanged` and fails if it would create a row. The contract has no invoice, payment or handover note until billing and the handover exist. Device node numbers are placeholders until gateway-sync 1.2 captures the golden fixtures. On 2026-10-27 LongLP added TL-0011 to TL-0016 (`treklink-v3`), because the eight `AVAILABLE` units were below `rentals.minOrderQuantity` per variant and no request could be approved for the MF-01 demo; a rerun on an existing database creates only those six
  - _Story: US-X02_

## Phase 2: Core Service Logic

- [x] 2.1 `ResponseInterceptor` with `@ResponseMessage`, `statusCode` equal to the HTTP status, paged results passed through (owner KhoaDD)
  - _Requirements: REQ-UBI-01, REQ-UBI-02, REQ-UBI-03, AC-01_
- [x] 2.2 `ValidationPipe.exceptionFactory` (owner KhoaDD)
  - **Files**: `backend/src/app.setup.ts`, `backend/src/common/pipes/validation-exception.factory.ts`
  - **Do**: flatten nested `ValidationError`s into `"<property> <constraint>; ..."` and throw `DomainException(400, VALIDATION_FAILED, message)`; `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
  - **Test**: `validation-exception.factory.spec.ts`: one bad property, two bad properties, a nested DTO property
  - _Requirements: REQ-ERR-01, AC-03_
- [x] 2.3 Prisma error mapping in `GlobalExceptionFilter` (owner KhoaDD)
  - **Files**: `backend/src/common/filters/http-exception.filter.ts`
  - **Do**: `PrismaClientKnownRequestError` `P2002` to 409 `CONFLICT_UNIQUE` with the target field in `message`; `P2025` to 404 `NOT_FOUND`; any other error 500 `INTERNAL_ERROR`, stack logged with the request id, message `Internal server error`
  - **Test**: extend `http-exception.filter.spec.ts` with `P2002`, `P2025`, an unknown Prisma code and a plain `Error`; assert no stack or SQL in the body
  - _Requirements: REQ-ERR-02, REQ-ERR-03, REQ-ERR-04_
- [x] 2.4 Request id and body limit (owner KhoaDD)
  - **Files**: `backend/src/common/middleware/request-id.middleware.ts`, `backend/src/common/context/request-context.ts`, `app.setup.ts`
  - **Do**: take `X-Request-Id` from the request or generate a UUID; store it in an `AsyncLocalStorage`; echo it in the response header; the logger prefixes it. Body parser limit `HTTP_BODY_LIMIT`; an oversize body maps to 413 `PAYLOAD_TOO_LARGE`
  - **Test**: e2e: the header is echoed and generated when absent; a 2 MB body gets 413 with the envelope
  - _Requirements: REQ-UBI-08, REQ-ERR-07_
- [x] 2.5 `ParameterService` and registry (owner KhoaDD)
  - **Files**: `backend/src/modules/platform/parameters/parameter.service.ts`, `parameter.repository.ts`, `parameter-registry.ts`
  - **Do**: `get<K extends ParameterKey>(key, tx?)` through a TTL cache (`PARAMETER_CACHE_TTL_SECONDS`); inside a transaction the value read first is reused for that transaction; `update(key, { value, expectedVersion, reason }, actor)`: `SELECT ... FOR UPDATE`, validate type and bounds, compare version, update the value, insert history, commit, then `parameter.changed` and `audit.record`
  - **Test**: `parameter.service.spec.ts`: bounds rejection leaves the value, stale version 409, cache hit and invalidation; `parameter-registry.spec.ts`: registry keys equal the seeded keys
  - _Requirements: REQ-UBI-06, REQ-EVT-03, REQ-STA-02, REQ-ERR-05, AC-06, FR-CFG-01, FR-CFG-02_
  - _Story: US-UC57_
- [x] 2.6 Audit sink (owner KhoaDD)
  - **Files**: `backend/src/modules/platform/audit/audit-sink.listener.ts`, `redact.ts`
  - **Do**: listen to `audit.record`; redact the keys of design §4.5 in `before` and `after`; insert with actor, roles, organization, action, subject, request id; on failure log the whole entry and return without rethrowing
  - **Test**: `redact.spec.ts` for every listed key, nested; `audit-sink.listener.spec.ts`: a failing insert does not throw
  - _Requirements: REQ-EVT-02, REQ-UBI-09, REQ-ERR-06, AC-07_
  - _Story: US-UC58_
- [x] 2.7 `emitAfterCommit` (owner KhoaDD)
  - **Files**: `backend/src/modules/platform/events/emit-after-commit.ts`
  - **Do**: queue events on the transaction context and emit them through `EventEmitter2` only after `$transaction` resolves; outside a transaction emit at once
  - **Test**: a rolled-back transaction emits nothing; a committed one emits once
  - _Requirements: design §2.3_
- [x] 2.8 Scheduler host (owner KhoaDD)
  - **Files**: `backend/src/modules/platform/scheduler/scheduled-job.decorator.ts`, `job-runner.service.ts`
  - **Do**: `@ScheduledJob(name, cron)` wraps a handler: `pg_try_advisory_xact_lock(hashtext(name))` in its own transaction (design §4.6, pooled connections), skip when held; log start, outcome and duration; catch and log errors so one job never stops another. Jobs read deadlines from the database. Module owners register their jobs of design §4.6 in their own module
  - **Test**: `job-runner.service.spec.ts`: lock held skips, an error is logged and the next run fires; e2e AC-09 restart resume lives in `incidents` 4.3
  - _Requirements: REQ-EVT-05, REQ-EVT-06, AC-09_
- [x] 2.9 Port tokens (owner KhoaDD)
  - **2026-10-30**: `STAFF_NOTIFICATIONS` is declared in platform and supplied by `AuthPortsModule` for contract emails; it adds no solid module dependency
  - **Files**: `backend/src/modules/platform/ports/index.ts` re-exporting `MQTT_HEALTH_PROBE`; the other tokens live in the declaring module (`ACCOUNT_CONTEXT_PROVIDER` and `API_KEY_RESOLVER` in `auth`, `ORGANIZATION_EXIT_CHECKS` in `organizations`, `CONTRACT_CLOSE_CHECKS` in `rentals`)
  - **Do**: multi-providers injected `@Optional()` as arrays
  - _Requirements: design §2.1_
- [x] 2.10 `RATE_LIMITED` and `@RawResponse()` (owner KhoaDD)
  - **Files**: `error-code.enum.ts`, `backend/src/common/decorators/raw-response.decorator.ts`, `response.interceptor.ts`
  - **Do**: add `RATE_LIMITED` (429); the interceptor passes a `@RawResponse()` handler's body through unwrapped (the SePay webhook, D-038)
  - **Test**: interceptor spec: a raw handler returns `{ "success": true }` unchanged
  - _Requirements: REQ-UBI-01_
- [x] 2.11 UTC timestamps: Prisma `DateTime` in UTC, serialised with `Z` by `JSON.stringify` (owner KhoaDD)
  - _Requirements: REQ-UBI-05_

## Phase 3: Query / Retrieval

- [x] 3.1 Parameter list and history; audit-log query (owner KhoaDD)
  - **Files**: `parameter.service.ts`, `parameter.repository.ts`, `backend/src/modules/platform/audit/audit-log.service.ts`
  - **Do**: list grouped by module with current value, bounds and version; history newest first, paged; audit log filtered by organization, actor, action, subject and date range, paged
  - **Test**: paging boundaries and each filter
  - **Done**: `ParameterReadsService` and `AuditLogService`. The list follows api-design 02: one paged list sorted by owning module then key, with an `ownerModule` filter, rather than nested groups. Actor names come through the `ACCOUNT_DIRECTORY` port that `auth` provides (design §2.1). Checked on Postgres 16 with the seed through the Nest context: history and audit rows resolve "Demo Admin", the `parameter.` action prefix matches, an unknown key is 404
  - _Requirements: UC-57, UC-58, FR-CFG-02_
  - _Story: US-UC57, US-UC58_

## Phase 4: API Presentation Layer

- [x] 4.1 `HealthController` and `HealthService` with the optional MQTT probe (TK-90) (owner KhoaDD)
  - _Requirements: REQ-EVT-04, AC-08, api-design 01_
- [ ] 4.2 `ParametersController` and `AuditLogController` (owner KhoaDD)
  - **Do**: api-design 02 to 05, `JwtAuthGuard` and `PoliciesGuard` (`parameter.manage`, `auditLog.read`), messages from each file
  - **Progress**: both controllers are built on the global guards of D-061 with `@CheckPolicies`; `test/platform-admin.e2e-spec.ts` covers every Validation row of 02 to 05 (401, 403, 400, 404, `PARAMETER_OUT_OF_RANGE`, `STALE_VERSION`) and AC-06 through the HTTP pipeline. Open: the AC-07 trigger test (`UPDATE audit_log` fails) needs a real database and joins the `test:db` suite of incidents 1.1 (#56)
  - **Test**: e2e for every Validation row of 02 to 05; AC-07 trigger test (`UPDATE audit_log` fails); AC-06 parameter change visible to the next reader
  - _Requirements: AC-01 to AC-09_
  - _Depends on: auth 4.2_
- [ ] 4.3 Swagger envelope wrapper on every operation when `SWAGGER_ENABLED` (owner KhoaDD)
  - **Partly done** (2026-11-01, KhoaDD under D-078): the flag gate. `backend/src/swagger.setup.ts` mounts `/api/docs` only when the validated `SWAGGER_ENABLED` is true (default on outside production, off in production), tested in `swagger.setup.spec.ts`. Open: the envelope wrapper on every operation
  - _Requirements: REQ-OPT-01_
- [ ] 4.4 Request throttling, Sprint 4 (owner KhoaDD)
  - **Files**: `backend/src/modules/platform/platform.module.ts`, `backend/src/common/decorators/access.decorator.ts`
  - **Do**: register `@nestjs/throttler` (approved 2026-09-25) as a global guard with a default limit, and a stricter limit on the `@Public` auth routes (`login`, `refresh`, `password/forgot`, `password/reset`, `password/set`); an exceeded limit answers 429 `RATE_LIMITED` in the envelope; limits are parameters, not literals (D-015)
  - **Test**: e2e that the next request past each limit is 429 `RATE_LIMITED` and that an authenticated route keeps the default limit
  - _Requirements: D-063 rule 11, OWASP Forgot Password Cheat Sheet (rate limiting)_

## Phase 5: Frontend Integration

- [ ] 5.1 `apiClient` envelope unwrap and `ApiError`; Parameters and Audit Log pages (owner LongNN, tracked in `specs/frontend/tasks.md` 1.2 and 7.4)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Suite green; lint, boundary check and typecheck clean (owner KhoaDD)
- [ ] 6.2 `api-design/*.md` and the Configuration Matrix regenerated and matching behaviour (owner KhoaDD)
