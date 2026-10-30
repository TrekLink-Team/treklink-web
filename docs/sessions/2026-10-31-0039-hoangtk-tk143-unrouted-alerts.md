# TK-143: Staff/Admin recipients for UNROUTED incidents, 2026-10-31

## Scope and tracking

HoangTK approved implementation, verification, commit, push and PR creation, with KhoaDD and LongNN requested for review. No merge is authorized.

TK-143 / US-UC30 already owns FR-INC-12 alert delivery. This is its bounded recipient-selection slice in incidents task 2.2, which also traces US-UC29. A duplicate Bug is unnecessary under Chapter 10's story/subtask model. TK-142 stays closed. References: PR #114's deferred Staff recipients, issue #118 R1 (resolved), D-079 and design section 3. Jira login prevents verifying the live assignee/status; no Jira record or status was changed. TK-143 is not complete: email and API-event senders remain open in task 2.1.

Branch: fix/TK-143-unrouted-staff-alerts, based on freshly fetched dev bf873177a6c87a768f539212fbeb55947e49ba02. The historical TK-147 branch is preserved.

## Change

- RoutingService reads AccountsService.activeStaffAndAdminIds(tx) when creation or reopening routes to UNROUTED, including an attributed organization without reachable members. The existing ingress, lifecycle, account filter and transactional outbox perform the remaining work.
- recipientsOf and ESCALATED behavior are preserved. Historical organization attribution is retained. No schema, permission, authentication, frontend, API 13, email or cadence change.
- Two existing database fixtures (mf03.db-spec.ts and authority-reports.db-spec.ts) now provide the real AccountsService because their UNROUTED paths reach the account read.
- Task 2.2 records the implemented slice and evidence; the box remains open for reconciliation of broader routing evidence. Frontend 8.2 remains open; R2 remains unresolved.

## Verification

Three routing regression assertions fail before the fix: empty recipients on both UNROUTED routes and an account-read error never reached. After the fix:

| Check | Result |
|---|---|
| Backend unit | 198 suites, 2,175 tests passed |
| Backend HTTP e2e | 18 suites, 404 tests passed |
| Backend database | 24 suites, 159 tests passed |
| New UNROUTED database suite | Four tests passed, then passed again on the same database after a lint-only correction |
| Frontend | 54 files, 639 tests passed |
| Gateway | Three suites, 11 tests passed |
| Workspace lint | Exit 0; existing warnings in incidents.e2e-spec.ts and CounterPaymentDialog.tsx |
| Module boundaries | 443 files, 50 models, nine modules, acyclic |
| Workspace typecheck and build | All three packages passed; frontend retains the large-chunk warning |
| D-053 | routing.service.ts, the only production file changed: 100% statements, branches, functions and lines |
| Task checker | One existing gap: unchanged frontend task 1.5 lacks the literal owner tag |

Database: disposable Postgres 16 container tk143-unrouted-db, localhost port 55438, database tk143_test. All 24 existing migrations applied. Every database test command explicitly set both database URLs to that local database. Shared Neon was not used.

The new suite exercises real ingestion, account reads, lifecycle and outbox. It verifies active Staff/Admin and dual-role recipients, excludes inactive/deleted and unprivileged accounts, rejects ten replays, reopens to UNROUTED, preserves a suspended organization's attribution, and rolls back field event, incident, history, outbox and post-commit notifications when an exception follows the outbox write. Existing escalation tests remain green.

Initial local verification encountered sandboxed Jest transform-cache EPERM and stale generated Prisma types plus missing locked pdf-parse. Used an ignored workspace cache, synchronized installed dependencies with npm ci, and regenerated Prisma. No manifest, lockfile, environment file, global tool setting or Checksum key changed. Removed four unnecessary non-null assertions in the new test; lint and its database suite passed afterwards. No browser smoke repeated for this backend-only fix.

## Delivery

Use HoangTK's existing hook/key with actual model GPT-6, stage CO. Open the PR against dev and request ruskicoder and NgocLong216. Do not merge. Record PR/CI results in the personal session record.
