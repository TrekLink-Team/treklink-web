# Week 9 incidents verification

HoangTK, 2026-11-02. Baseline origin/dev 5f0c416. PR #242 merged November 1.

Changes: four cadence cases using 3 positions in 30 seconds, including count minus one,
inclusive boundary, one millisecond outside and out-of-order arrival. Forward migration changes
only the simulator parameter description; the catalog and generated configuration matrix agree.
The suspected-message specification awaits review and implementation. No runtime defaults changed.

## Executed checks

- `npm ci --no-audit --no-fund`: installed locked dependencies. Host Node 22.15 reports engine warnings.
- `npm rebuild bcrypt better-sqlite3 esbuild @prisma/client @prisma/engines`: succeeded.
- `npx prisma generate --schema backend/prisma/schema.prisma`: succeeded.
- `npx jest incident-ingress.spec.ts --runInBand --coverage --collectCoverageFrom=modules/incidents/incident-ingress.ts`: 44 passed; 100% lines and branches, bundled Node 24.22.1, 8.078 seconds.
- Broad backend unit run: 235 suites passed, 5 failed; 2696 tests passed, 1 failed. Module-loading failures and a handover renderer timeout prevent a green verdict.
- Broad database run: 36 suites passed, 3 failed; 214 tests passed, 6 failed. Cadence suite failed at connection setup: `PrismaClientInitializationError: Can't reach database server at 127.0.0.1:55439`. Loss-case suite reported a missing Nest helper module.
- Broad HTTP run: 12 suites passed, 8 failed; 405 tests passed, 8 failed. Incidents HTTP suite passed. Scheduler mocks also logged `this.prisma.$transaction is not a function`.
- Workspace lint, typecheck and build commands were attempted; build output reaches successful Vite completion. Separate exit codes for all intermediate gates were not captured, so those gates remain unverified.
- Frontend Vitest produced its startup banner without a recorded final result. No pass claimed.

Local logs remain under `ignore/hoangtk/week9-*.log`. Broad checks ran concurrently; rerun failed
suites in isolation on the supported Node version before attributing failures to source code.

## Task 8.1

- [ ] Suite green: broad failures above.
- [ ] Lint verified independently.
- [ ] Module boundaries verified independently.
- [ ] Typecheck verified independently.
- [ ] Every API design matches behavior: API 13 is still listed as open in tasks 5.1 and 6.1.

The original 8.1 checkbox remains unchecked. No whole story or module is marked Done.

## MF-03 evidence and limitations

Created disposable Postgres 16 container `hoangtk-week9-20261102`, id
`191a5e35b8f193925f8ddde2a4af31724a46756a76ba1aa3dc130a4673d25768`, bound to loopback port 55439.
All 39 baseline migrations applied successfully. The database later became unreachable during the
broad run. The database suite includes `mf03.db-spec.ts`, but a database suite run does not prove
the complete browser/MQTT stack. MQTT and browser MF-03 smoke remain outstanding. No physical
LoRa test was performed. Shared Neon and existing credentials were not changed.

Jira ownership was read; no transitions made because the assigned verification is incomplete.
The noon daily report cutoff had passed before this session. Do not describe the report as on time.

Handbook gate: re-read PDF sections 1.4, 1.5, 3 and 4 using pdf-parse. No diagrams changed.
Human prose scan of the new message spec: zero findings.

## Recovery, 2026-11-02 afternoon

The earlier results above remain as the original run record. Recovery establishes:

- Codex rollout `turn_context.payload.model` records `gpt-6.1-sol` for this chat, including the
  original authoring turn. Chapter 11 and tk_checksum.py allow that exact model. The old `gpt-6`
  declaration was incorrect. The rejected command was denied by automatic approval before any
  shell or Git hook ran. Global Git still declares `claude-opus-5-5`; it was not changed and must
  not be used for these changes. No commit/push was retried while tests remained red.
- Docker was stopped. The existing PostgreSQL container exited 0, OOMKilled=false, after a
  fast shutdown request at 07:31:06 UTC; the initiator is unknown. Restarted the same container,
  preserving all data. SQL and pg_isready confirmed PostgreSQL 16.15 on loopback port 55439.
- Database rerun: **39 suites, 230 tests passed**, exit 0, including cadence and both MF-03 suites.
- HTTP rerun: **20 suites, 431 tests passed**, exit 0.
- Frontend: **99 files, 1087 tests passed** on bundled Node 24.22.1.
- Gateway: **12 suites, 90 tests passed** on Node 22, matching the installed SQLite binary ABI 127.
  Node 24 first rejected that binary because it requires ABI 137; dependencies were not changed.
- Workspace lint, typecheck and build each exited 0. Lint includes the successful module-boundary
  check: 537 files, 53 owned models, 10 modules, acyclic. One existing frontend fast-refresh
  warning and Vite bundle-size warnings remain.
- Broad backend rerun: 239 suites passed, 1 failed; 2725 tests passed, 1 failed. The failing test
  is `renderHandoverNote > titles a replacement and names the unit it replaces`, in
  `handover-note.renderer.spec.ts`, from pdf-parse at line 96. Direct serial Jest reproduced it.
  Neither renderer nor its tests are changed by this work or the fetched upstream changes.

### Task 8.1 verified criteria

- [ ] Whole suite green: backend PDF renderer failure remains.
- [x] Lint: exit 0, one pre-existing warning.
- [x] Module boundaries: passed.
- [x] Typecheck: exit 0.
- [ ] API designs all match behavior: controller has no `GET :id/events`, while API 13 specifies it.

The module's parent 8.1 checkbox remains unchecked. No Jira story moved to Done or In Review.

### Actual local-stack smoke

Created a separate empty `treklink_week9_smoke` database inside the same local container, without
deleting either database. Applied all 40 branch migrations. Verified simulator value=60 and
version=1 with the new description. Created local broker `hoangtk-week9-mqtt`, bound to loopback
18839, using the repository Mosquitto configuration. Backend on 3009, frontend on 5179; isolated
generated demo credentials and console email. Seed handover time was ten minutes before the run
to satisfy the documented attribution margin without changing the parameter.

Command: bundled Node 24 executes `ignore/hoangtk/week9-stack.cjs`, then
`ignore/hoangtk/week9-browser-smoke.cjs`. The latter publishes the synthesized SOS fixture with
fresh id and current timestamp over MQTT, drives real Chrome, and checks Postgres directly.

At 07:50:51.508 UTC Operator sign-in and map passed; 07:50:51.788 UTC the SOS banner passed;
07:50:52.323 UTC acknowledgement passed; 07:50:52.510 UTC response passed;
07:50:52.672 UTC persisted resolution passed. Transition trail:
`DETECTED -> NOTIFY_PRIMARY -> ACKNOWLEDGED -> RESPONDING -> RESOLVED`.
Screenshot `ignore/hoangtk/week9-smoke-resolved.png` was opened and inspected. It shows the owner,
outcome and full transition history. Last position displays "Position unavailable", so this smoke
does not establish position plotting. No physical LoRa hardware tested, no external email sent.
JWT/CASL negative cases are covered separately by the passing HTTP/database suites.

### Delivery state

Fetched origin/dev advanced to d4929a2 and includes new field-simulation work in incidents and
gateway-sync. The current checkout remains on the preserved 5f0c416 baseline with uncommitted
changes. Rebase and rerun affected checks before delivery; no upstream changes were overwritten.
No commit, push, PR, reviewer request or CI success is claimed. The PR gate requires green tests;
the remaining renderer failure prevents delivery. User/owner must resolve that failure, then resume
with the verified model declaration through the unchanged hook. API 13 remains separate incomplete
module work and must not be ticked by a happy-path smoke.

Daily report posted late, explicitly saying so:
https://github.com/TrekLink-Team/treklink-docs/issues/150#issuecomment-6572001133.
Local recovery detail, scripts, credentials and raw logs remain under `ignore/hoangtk/` and are
not intended for staging. Existing untracked `backend/ignore/` coverage output is preserved.

## Baseline diagnosis and rebase, 2026-11-02 15:04 to 15:11 ICT

Clean detached origin/dev worktree at `6c8cca5`: `capstone/release/week9-clean-dev`, with an ignored
node_modules junction to the existing locked install. Its status is clean. Renderer, renderer spec
and lockfile match the Week 9 checkout exactly.

Baseline command, bundled Node 24.22.1:
`node node_modules/jest/bin/jest.js --config backend/package.json --runInBand --runTestsByPath backend/src/modules/rentals/handover-note.renderer.spec.ts --json --outputFile baseline-pdf.json`.
Result: 7 passed, 1 failed, 5.91 seconds. Structured JSON reveals `UnknownErrorException`,
`Illegal character: 41`, details `FormatError: Illegal character: 41`, through pdf-parse's
PDF.js 1.10.100 at spec line 96. Evidence: `ignore/hoangtk/week9-clean-dev-pdf.{log,json}`.
This proves the failure predates this diff, not the underlying parser defect's cause.
Rentals production code and tests remain unchanged.

Escalation: https://github.com/TrekLink-Team/treklink-web/issues/311. Requested baseline fix or
explicit leader exception for PR delivery. Chapter 07's red-CI discretion does not itself record
that approval; the installed PR skill requires passing local tests. No ruling at last check.

Preserved seven Week 9 paths in named stash `a290c967d8a94ebbc026bf285b6be2374b4bc490`,
rebased `chore/cadence-follow-ups` onto `6c8cca5`, and reapplied cleanly without dropping the stash.
Private files, untracked coverage, credentials and local data remain. No reset or clean.

### Post-rebase evidence

Prisma generation and additive local migrations succeed. An initial Jest filter flag was ignored
by this version, causing a full backend run; focused tests then ran with a positional filter.

| Check | Result |
|---|---|
| Full backend | 243 suites/2807 tests pass, 1 suite/1 test fails: same baseline PDF failure; 182.685 seconds |
| Focused cadence/ingestion | 4 suites, 91 tests pass; 100% ingress line and branch coverage |
| Incidents/MF-03 local database | 6 suites, 55 tests pass |
| Incidents HTTP | 1 suite, 40 tests pass |
| Workspace lint, including boundaries | exit 0, existing fast-refresh warning |
| Workspace typecheck | exit 0 |
| Workspace build | exit 0, bundle-size warning |
| Configuration Matrix versus generator | text matches |
| git diff --check | clean |

Commands: bundled Node runs Jest directly, positional filter
`incident-ingress|ingestion|incidents.repository.reads` for focused tests; database config
`backend/test/jest-db.json` with `incidents|mf03`; HTTP config `backend/test/jest-e2e.json`
with `incidents`; workspace `npm run lint`, `npm run typecheck`, `npm run build`.
Logs: `ignore/hoangtk/week9-rebased-*.log`. Prior real browser/MQTT smoke is evidence for its
recorded earlier baseline; no second browser run after rebase is claimed. Task 8.1 now checks
only lint, boundaries and typecheck; whole-suite and API-13 criteria remain open.

Fresh current-session turn_context at 08:04:00 UTC records `gpt-6.1-sol`. Git Bash's exact hook
interpreter python3 reports Python 3.12.10 and passes Checksum selftest 61/61. Hook chain,
HoangTK member, keys and global model settings are unchanged. A future authorized commit must
use per-command TK_MODEL=gpt-6.1-sol, not global claude-opus-5-5. No fabricated attestation.

No commit, push or PR while the exception is unresolved; PR links: none. No CI success, Jira
transition or duplicate Daily Report. Next: Rentals owner fixes the baseline test or KhoaDD
records the explicit exception on #311, then finish scoped delivery and request KhoaDD review.

## Leader-authorized delivery, 2026-11-02 15:22 ICT onward

KhoaDD explicitly authorized push and PR creation today despite the local PDF failure, including
Draft status, in the Daily Report reply:
https://github.com/TrekLink-Team/treklink-docs/issues/150#issuecomment-6572051373.
The exception permits delivery; local whole-suite and API-13 criteria stay unchecked. The leader's
local-font/native-dependency explanation is a hypothesis, not an established root cause.

Fetched current dev `cc1a383`. Verified #307 merged at 07:45:28 UTC (d4929a2) and #309 at
07:56:13 UTC (ce7848a). New upstream changes since 6c8cca5 affect only billing/rentals specs.
Created second named recovery stash `f8a835f8305e3da7a014d5e5779ef5fa7e2b5cf8`, rebased and
reapplied cleanly, retaining both stashes and all unrelated files.

Final checks at cc1a383: cadence/ingestion 4 suites/91 tests passed, 100% ingress lines and
branches (12.829 seconds); incidents/MF-03 local database 6/55 passed (26.383 seconds);
incidents HTTP 1/40 passed (6.432 seconds). Workspace lint and typecheck exit 0. Logs:
`ignore/hoangtk/week9-delivery-{focused,db,http,lint,typecheck}.log`.
The prior broad local PDF failure and clean-baseline evidence remain above; no false green claim.
Fresh Codex turn_context at 08:22:43 UTC records gpt-6.1-sol. Existing Checksum hook is used with
that exact per-command declaration and HoangTK's member setting. No keys or hooks changed.

The PR body explains API 13's missing episode-event collection and map trail, its UC-29/FR-INC-01
trace, and the unfinished portions of tasks 5.1, 6.1, 6.2, frontend screen 8.1 and 8.1. API 12
transition history and API 14 alert log are separate. Cadence AC-05 and MF-03 actions remain
independently verifiable. API 13 implementation is outside the assigned #242 follow-ups and
verification scope; leader decides follow-up versus expansion. No Daily Report duplicate.
