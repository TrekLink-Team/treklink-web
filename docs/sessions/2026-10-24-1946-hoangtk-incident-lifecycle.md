# HoangTK incident lifecycle, 2026-10-24

## Scope

- The user asked to continue implementation after foundation PR 56 merged. The leader prioritizes incidents 2.3 for the ingestion hand-off.
- Web baseline: `49ea281`. Task 2.3 requires the approved lifecycle and routing behavior. This change implements prerequisite task 1.2, on `feat/TK-142-incident-lifecycle`, without replacing another module's missing roster, contact-card or custody service.
- Read incident requirements/design/tasks, D-034 and D-038, the parameter catalogue, the existing repository and transaction/event implementations, and the acknowledgement error precedence of D-059.
- The lifecycle accepts trusted recipient IDs from its calling domain service. It does not read organization or account tables. Resolving the roster and Staff recipients remains part of routing and integration.
- Scope: twelve-state transition matrix, actor/owner/organization guards, expected state/version checks, persisted timers, sequenced history, alert outbox and after-commit domain events. No controller, scheduler, dispatcher or ingress hand-off is claimed complete by this change.

## Verification plan

- Exercise all twelve-by-twelve state pairs and actor, deadline, stale-version and ownership edge cases.
- Check empty-tier skipping and resulting owner/deadline invariants.
- Verify Postgres races, sequenced history, outbox atomicity and events only after commit; keep HTTP pipeline and existing tests green.
- Run lint, boundaries, typecheck, build, focused coverage and specification/prose checks before review submission.

## Implementation checkpoint

- Added the lifecycle with the task's six-argument `apply` signature. Its structured reason carries event time, optional expected version, trusted recipients, optional note/event reference, and fresh attribution on reopen.
- Added incident-only row locking, compare-and-set and sequenced history writes to the repository. Added `ALREADY_OWNED` and `NOT_OWNER` to the shared error enum from the approved catalogue.
- The module now imports platform for runtime parameters and after-commit events. The lifecycle and repositories stay private until the domain integration services are added.
- All 206 incident unit tests pass, including every state pair. Incident implementation coverage is 100% lines and 98.13% branches in the first full incident run. Corrected a test actor annotation and unnecessary assertions caught by TypeScript/lint.
- Initial Postgres migration could not run because Docker stopped before the command reached the database. The exact Prisma output was `Error: Schema engine error:` with no additional diagnostic. Docker CLI then reported its engine pipe absent. Restoring the isolated service before claiming database results; no shared database was used.

## Verification results

- Restored Docker through `docker desktop start`. A new isolated Postgres 16 container applied all eight existing migrations successfully. No application database was selected or changed.
- All 24 database tests passed, the 17 foundation cases plus seven lifecycle cases: acknowledgement race, timer behind a human action, sequenced empty-tier skips, queued events after commit, caller rollback, outbox failure rollback, reconstructed deadline handling, and response/resolution/reopen. Some cases cover more than one condition.
- Full backend regression: 46 unit suites, 542 tests passed; six HTTP/replay e2e suites, 37 tests passed. Lint and module boundaries passed with 123 files and an acyclic nine-module graph. TypeScript and the Nest build passed. Existing MQTT and health failure-path logs are intentional test output.
- The task coverage checker reports zero gaps. The implementation adds no schema, migration, package dependency or endpoint. The refreshed lockfile required newer Node versions for existing frontend dependencies, so local Node 22.15.1 printed engine warnings during `npm ci`; the backend checks above succeeded.
- Updated the test README and checked task 1.2 in the same change. Task 2.3, routing 2.2, scheduler jobs, dispatcher and human-action/controller services remain unchecked. This PR does not claim those integrations complete.
- Reopen uses occurrence time inside the stored half-open window, even when delivery is later, and requires a fresh route. The implementation preserves the approved twelve-state edges; it does not add a new reopen destination.
- Recipient snapshots are internal trusted inputs, never HTTP input. Resolution of active roster and Staff IDs remains with the calling domain integration. Empty tiers skip in one transaction with one history row per hop. Manager and Staff deliveries retain their respective tiers and overlapping recipients are deduplicated.
- Self-review retained the explicit matrix and transaction boundary checks. No new provider abstraction or dependency was added. The annual code allocator from task 1.1 is unchanged.
- Final focused run: 206 tests passed, 100% line/function coverage and 98.18% branch coverage across the incident implementation; the lifecycle alone has 100% line coverage and 97.81% branch coverage. Formatting, prose and whitespace checks passed. Human phrase scan reported zero violations.
