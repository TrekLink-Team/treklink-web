# HoangTK incident foundation, 2026-10-23

## Scope and baseline

- The user asked to verify the merged screen follow-up and continue.
- PR #49 is approved and merged at `c2703174`. Fast-forwarded clean checkouts to web `945313f` and docs `17b2f4b`.
- Rechecked the approved incident requirements, design and tasks against the merged schema and repository patterns.
- Task 1.1 uses only the existing incident models. The task list explicitly starts Phase 1 in Sprint 3. The earlier personal handoff incorrectly held all incident foundation work on the module-wide integration dependencies.
- Implement task 1.1 on `feat/TK-142-incident-foundation`, under the first consuming story, US-UC29 / TK-142. Scope covers repositories, module wiring, incident codes, conflict recovery and verification. Lifecycle, routing, ingress, dispatch and HTTP presentation remain separate tasks.

## Verification plan

- Unit checks for repository behavior, code boundaries, selective unique-conflict recovery and module dependency injection.
- Postgres checks for concurrent creation, recovery inside a live transaction and atomic rollback of incident/outbox/report writes.
- Backend lint, module boundaries, typecheck, unit/e2e suites and build; task coverage checker and prose checks.
- Use an isolated local test database. No migration, dependency update or application database change is required.

## Implementation and first verification

- Added private incident, alert-delivery and authority-report repositories, registered in `IncidentsModule`, and imported that module in the application.
- Inserts require the caller's transaction. A savepoint restores the transaction after the named open-device unique violation; the repository then locks and returns the winning incident with `created: false`. Other unique, foreign-key and connection errors propagate.
- Codes use the processing UTC year, six digits, and a transaction-scoped advisory lock before reading the latest code. The annual lock serializes creation until the outer transaction commits. A comment records its throughput ceiling and the trigger for replacing the allocator. No new schema object is needed.
- Alert enqueueing preserves schema defaults and uses the transition's transaction. Authority-report input permits exactly one subject, backed by the existing database constraint. These repositories do not implement lifecycle or routing rules.
- Added `test:db` and a separate Jest configuration, with a required Postgres integration step in CI. The suite requires explicit database URLs and creates run-specific fixtures without deleting existing data.
- The isolated local Postgres 16 container applied all eight existing migrations. All 17 database tests passed, including ten-way same-device and different-device races, every non-closed state, recovery with further writes, and incident/history/outbox/report rollback.
- The first focused unit run passed 23 tests with 100% statement, branch, function and line coverage for all four incident implementation files. TypeScript passed. Lint found one unsafe mock access in a test, corrected before the full checks.

## Full verification

- Backend lint and module boundaries passed: 98 files, 49 models and nine modules in an acyclic graph. TypeScript passed.
- All 39 unit suites passed, 315 tests. All four HTTP/replay e2e suites passed, 21 tests. The Nest build passed.
- Existing MQTT and health failure-path tests intentionally log errors and warnings. The unit run also reports the existing ts-jest `allowJs` warning for the boundary checker; it does not fail a check.
- The task coverage checker reports zero gaps. The prose checker and `git diff --check` pass.
- Added test-suite usage documentation. The database suite captures explicit connection settings before constructing Prisma and supplies the URL directly, so a local environment file cannot select its target implicitly.
- Task 1.1 is checked in the same change. US-UC29 as a whole and the remaining incident tasks stay incomplete. No schema, migration, external service, endpoint or frontend runtime behavior changed.
- After the explicit connection guard, all 17 database tests passed again; lint remained clean and the 23 focused tests retained 100% coverage across the four implementation files. Formatting and TypeScript also passed.
- Human phrase scans of this record and the test README reported zero violations. The structure scan's sentence-length advisory was reviewed as a metric on an evidence ledger; no technical statement was changed to vary its cadence.
- Self-review found no cross-module model access or new abstraction to remove. The only deliberate ceiling is the documented annual allocation lock. The source branch is based on current `origin/dev`; the review submission will use HoangTK's CO Checksum and leave merging to the leader.
