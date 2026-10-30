# 2026-10-30, HoangTK, TK-147 Staff false alarm

## Traceability and scope

- User confirmed the live Jira assignment of TK-147 to HoangTK before implementation. Primary story: US-UC34, UC-34 Declare False Alarm, FR-INC-04 and FR-INC-08, BR-15, D-034 and D-038. API 07 only. Incidents tasks 4.2, 6.1 and 6.2; frontend 8.2 false-alarm portion only.
- Branch `feat/TK-147-staff-false-alarm` starts from `origin/dev` `c5cd3a2`. The working tree was clean. No overlapping false-alarm PR was open.
- Preserve the Staff queue (#127), owner-deactivation listener (#140) and authority-report flow (#145). API 13, evidence panels, filters and other frontend 8.2 gaps remain outside this work.

## Implementation checkpoint

- API 07 accepts the existing `respondUnrouted Incident` permission alongside the member permission. `IncidentsService.falseAlarm` locks the incident for Staff/Admin, checks UNROUTED, then calls the existing lifecycle with a STAFF actor and expectedVersion. Members retain their organization-scoped path. No permission, schema or migration added.
- Staff detail offers a false-alarm dialog only to Staff/Admin on UNROUTED. The reason and reviewed version survive recoverable errors; an explicit Reload is required before another POST. Duplicate submits and closing during a pending write are blocked. Dirty cancellation asks before discarding. Success invalidates queue/detail, shows MSG03 and focuses the queue heading, or retains the All incidents detail.
- Regression tests cover Staff/Admin, invalid states, stale versions, member isolation, concurrent writers and rollback; HTTP policy/validation; frontend confirmation, cancellation, pending, retry, error and focus paths.

## Verification checkpoint

- Focused frontend: 19 tests pass. Backend service/controller: 68 tests pass. API e2e: 40 tests pass.
- All database tests: 16 suites, 99 tests pass on disposable postgres:16 at localhost:55437, after migrations. Shared Neon was not used.
- Before the final rebase: backend unit coverage passed 184 suites / 2032 tests; e2e passed 15 suites / 228 tests. Service and controller both reached 100% line and branch coverage. Frontend passed 46 files / 549 tests; StaffIncidentsPage reached 100% lines / 90.27% branches, and StaffFalseAlarmDialog reached 100% lines / 97.95% branches. Backend/frontend lint and typecheck, both builds, and gateway lint/typecheck/tests passed. Backend lint retains the existing unused `_omitted` warning in the e2e fixture.
- Browser smoke on the local API and disposable database passed Staff and Admin saves, required-reason validation, MSG03, queue refresh and heading focus. At 360px, the dialog fits without horizontal overflow; Escape, Keep editing and Discard reason preserve or discard the draft and move focus appropriately.
- The demo seed attempted after tests had populated the smoke database failed at its contract-2 term lookup (`seed-demo.ts:686`). A minimal ignored local fixture enabled the browser smoke instead. On a separate fresh database, migrations and the demo seed passed, then a second seed created zero row groups. The earlier failure therefore does not establish a seed defect on a clean database. No shared database or environment file was changed.
- Measuring coverage initially altered installed packages without changing manifests or the lockfile and temporarily broke dependency resolution. Restored the locked workspace with `npm ci --ignore-scripts`, rebuilt the existing bcrypt and better-sqlite3 bindings, and generated Prisma. The final frontend coverage provider ran from an isolated ignored directory through a temporary junction; the junction was removed. No dependency changes are part of this PR.
- Latest fetch advanced `origin/dev` to `8ff6c59`. Its changes did not overlap the Staff false-alarm implementation. A named stash preserved the work, the branch rebased cleanly, and the stash reapplied without conflicts.
- After rebase: backend 187 suites / 2059 unit tests, 15 suites / 257 e2e tests, frontend 46 files / 559 tests all passed. Both changed backend source files remain at 100% lines and branches. Backend/frontend lint, typecheck and builds passed. The database suite passed 19 suites / 115 tests on the earlier disposable database.
- A fresh seeded database exposed an MF-03 integration assertion at `mf03.db-spec.ts:323`: one global dispatcher batch delivered older fixtures before this test's own SOS. All TK-147 database cases passed. An untouched detached copy of `origin/dev` reproduced the same failure with the original suite order (56 passed / 1 failed). The same baseline passed when Jest ordered MF-03 earlier, confirming the order dependency. Corrected this incidents integration test to drain its finite due backlog across batches while retaining the delivery/content/status assertions. No dispatcher production behavior changed.
- Independent static review found four frontend defects, then confirmed their fixes: preserve the dialog across a recoverable background GET failure; remove submit on a live state change while retaining its reason and reviewed version; keep a read-only textarea focusable during pending requests; close inaccessible detail, purge its cache and refresh the queue after GET/POST 403/404. Focused tests passed 25 cases; full frontend tests passed 565. Final coverage: StaffIncidentsPage 100% lines / 91.13% branches, StaffFalseAlarmDialog 100% lines / 98.07% branches. Frontend lint, typecheck and production build passed after these fixes.

## Follow-up boundaries

Frontend 8.2 stays open. R2 in #118 only blocks the episode panel, which is outside TK-147. Reviewer is KhoaDD. Model for this session: GPT-6; new commits must declare `TK_MODEL=gpt-6`, not the repository's previous Claude model setting.

## Submission verification

- The corrected incidents integration test passed against the original failing backlog. A fresh migrated and seeded release database then passed all 19 suites / 115 tests, with the failing order retained by an ignored test sequencer. The second seed created zero row groups. The static reviewer found no concern in the bounded batch-drain correction.
- Final browser save on the reviewed frontend: Staff marked INC-2026-147003 false, the dialog closed, MSG03 and the named success notice appeared, and focus returned to `staff-incidents-title`. Earlier Staff/Admin and 360px smoke checks passed as recorded above.
- The final fetch found unrelated monitoring/device history changes on `origin/dev` `4bb0957`. The three own CO/UT/DOC commits rebased cleanly onto that base; their checksums verified as HoangTK / GPT-6. No overlapping Staff false-alarm implementation was found. No other member's commit was changed or sealed.
- Final rebased backend: 190 suites / 2088 unit tests, 15 suites / 257 e2e tests. Both changed backend source files reached 100% line and branch coverage. Lint, typecheck and build passed; the boundary checker passed 430 files / 50 models / nine acyclic modules.
- Final fresh PostgreSQL database: all inherited migrations, seed (50 groups), repeat seed (zero groups), 21 suites / 121 tests passed. This includes the new tests inherited from dev. All database operations used task-owned localhost PostgreSQL 16; no Neon operation ran.
- Frontend source was unchanged by the latest dev changes: 46 files / 565 tests passed after the review fixes; lint, typecheck and production build passed again after rebase. Coverage remains 100% lines / 91.13% branches for StaffIncidentsPage and 100% / 98.07% for StaffFalseAlarmDialog. Gateway lint, typecheck, build and three suites / ten tests passed again.
- Smoke servers, the fixture script and the clean detached baseline worktree were removed. The existing tool configuration, environment files, keys, package manifests and lockfile remain unchanged. The disposable database container is removed after verification.
- PR submission is authorized. Request KhoaDD for the story and LongNN for frontend consistency (D-053). Jira IN REVIEW and the Zalo review ping remain developer actions. CI results must be read from GitHub for the pushed head.

## Review handoff

- Opened [PR #168](https://github.com/TrekLink-Team/treklink-web/pull/168) targeting `dev`, Ready for Review, with KhoaDD (`ruskicoder`) and LongNN (`NgocLong216`) requested. The published implementation head was `4ca1e35`; GitHub's checksum check passed for that head and the three CI package jobs started. Consult the PR checks for the latest result, rather than treating local gates as CI evidence.
- The working tree was clean after submission. The task-owned PostgreSQL container and local smoke servers are stopped. No merge was performed. Frontend 8.2, #118 R2 and unrelated module work remain outside this handoff.
