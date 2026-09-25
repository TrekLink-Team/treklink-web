# Implementation Tasks: platform

> Approved by: pending (spec approval requested in `_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: none, Jira is empty and this is foundation work (D-024)
>
> Fulfills `design.md` in this folder. First implementation work of Phase B; every module waits on Phase 1 and 2 here.

## Phase 1: Foundation & Domain Modeling

- [x] 1.1 Turn on `strict: true` in `backend/tsconfig.json`; fix the scaffold until `npm run typecheck` is clean
  - _Requirements: NFR table, `02-spec-driven-development-workflow.md` Phase 5_
- [x] 1.2 `EnvironmentVariables` class plus `validate()` for `ConfigModule.forRoot`; fail fast naming each bad variable
  - _Requirements: REQ-EVT-01, AC-04_
- [x] 1.3 Datasource: `url = env("DATABASE_URL")`, `directUrl = env("DATABASE_DIRECT_URL")`; document Neon versus Docker selection in `.env.example`
  - _Requirements: REQ-STA-01, REQ-OPT-02, AC-05, D-010_
- [x] 1.4 Prisma models `AuditLog`, `BusinessParameter`, `BusinessParameterHistory`, enum `ParameterType`
  - _Requirements: design §4.4, §4.5_
- [x] 1.5 Write the **initial migration** from the approved system ERD (design Figures 5 to 8), covering every module's tables, so the schema lands once and in dependency order
  - Includes `CREATE EXTENSION btree_gist` and the `device_allocations` exclusion constraint (rentals design)
  - Includes the `raise_append_only()` trigger function and its triggers on every append-only table
  - _Requirements: REQ-UBI-07, design §3.3, D-001_
- [x] 1.6 Seed migration for the parameter registry defaults and the system roles and permissions (`auth` design §3)
  - _Requirements: REQ-UBI-06, US-001_
- [x] 1.7 `common/errors`: `ErrorCode` enum, `DomainException`, cross-cutting codes of design §4.2
  - _Requirements: REQ-UBI-04_
- [x] 1.8 Shared `PagedQueryDto` and `PagedResult<T>`, bounds from `DEFAULT_PAGE_SIZE` and `MAX_PAGE_SIZE`
  - _Requirements: REQ-UBI-03_
- [x] 1.9 Module-boundary check script: model-to-module ownership map, fails when a module references a model it does not own; wire into `npm run lint`
  - _Requirements: NFR-MNT-01, design §2.2_

## Phase 2: Core Service Logic

- [ ] 2.1 `ResponseInterceptor` reads `@ResponseMessage`; `GlobalExceptionFilter` emits `result = { errorCode }`; `ValidationPipe.exceptionFactory` produces `VALIDATION_FAILED`
  - _Requirements: REQ-UBI-01, REQ-UBI-02, REQ-ERR-01, AC-01, AC-02, AC-03_
- [ ] 2.2 Prisma error mapping `P2002` to 409 `CONFLICT_UNIQUE`, `P2025` to 404 `NOT_FOUND`; everything else 500 `INTERNAL_ERROR` with a logged stack
  - _Requirements: REQ-ERR-02, REQ-ERR-03, REQ-ERR-04_
- [ ] 2.3 `RequestIdMiddleware` with `AsyncLocalStorage`; `X-Request-Id` header; logger includes it
  - _Requirements: REQ-UBI-08_
- [ ] 2.4 `ParameterService` with registry, typed `get<K>()`, TTL cache, `update()` with version check and history, audit emit
  - _Requirements: REQ-EVT-03, REQ-STA-02, REQ-ERR-05, AC-06_
- [ ] 2.5 Audit sink listener for `audit.record`, redaction list, failure logged without rethrow
  - _Requirements: REQ-EVT-02, REQ-UBI-09, REQ-ERR-06_
- [ ] 2.6 Post-commit domain-event helper (`emitAfterCommit`) used by every module
  - _Requirements: design §2.3_
- [ ] 2.7 Scheduler host with advisory-lock single-instance guard and per-run logging
  - _Requirements: REQ-EVT-05, design §4.6_
- [ ] 2.8 Unit tests: interceptor, filter (each branch), parameter bounds and version conflict, redaction, scheduler lock
  - _Requirements: all of §2_

## Phase 3: Query / Retrieval

- [ ] 3.1 Parameter list and history queries; audit-log query with filters on the two indexes
  - _Requirements: UC-19, UC-20_
- [ ] 3.2 Unit tests for filter parsing, `from` after `to` rejection, page bounds
  - _Requirements: REQ-ERR-01_

## Phase 4: API Presentation Layer

- [ ] 4.1 `HealthController` (public), `ParametersController`, `AuditLogsController` with `JwtAuthGuard` and `PoliciesGuard` (guards come from `auth` Phase 4; wire once they exist)
  - _Requirements: api-design 01 to 05_
- [ ] 4.2 Swagger: a generic envelope schema wrapper so every operation documents `{ result, isSuccess, statusCode, message }`
  - _Requirements: REQ-OPT-01_
- [ ] 4.3 E2E tests against Docker Postgres for api-design 01 to 05, every status code in each Validation table; AC-07 trigger test; AC-08 health with the database stopped
  - _Requirements: AC-01 to AC-08_

## Phase 5: Frontend Integration

- [ ] 5.1 `apiClient` envelope unwrap and `ApiError` (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Full test suite green (`npm test`, e2e against Docker Postgres)
- [ ] 6.2 Lint, boundary check and typecheck clean
- [ ] 6.3 `api-design/*.md` matches actual behaviour
- [ ] 6.4 Configuration Matrix regenerated from the parameter registry
- [ ] 6.5 Session file written under `docs/sessions/`
