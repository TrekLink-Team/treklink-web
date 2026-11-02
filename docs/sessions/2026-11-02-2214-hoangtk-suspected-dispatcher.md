# Suspected transition alert wording

HoangTK Week 9 follow-up after merged API 13 (#314). Based on dev 829601c.
Leader ruling: https://github.com/TrekLink-Team/treklink-web/pull/313#pullrequestreview-5734042949.
The accepted suspected-incident-message.md contract is now implemented. A displayed suspected
alert is not rewritten when confidence upgrades. incident.changed refetches confidence in detail
and queue; any later confirmed transition alert uses MSG31.

## Changed paths

- AlertDeliveriesRepository's existing claim joins confidence/source from the incident. Locks,
  PENDING filter, channels, lease, settlement and attempt accounting are unchanged.
- AlertDispatcherJob's shared live/email payload builder chooses suspected wording only for
  SUSPECTED/CADENCE_INFERRED transitions. Existing device/holder fallback and configured UTC+7
  clock are reused. MSG31 remains the confirmed transition text; STALE retains MSG40.
- AlertBanner's polling fallback uses suspected wording and keeps existing text while the same
  incident remains in the same state. A later confirmed transition may show MSG31. Socket mode
  already kept text on incident.changed; the new regression proves this and later alert replacement.
- LiveProvider production code is unchanged. A real QueryClient test proves incident.changed
  refetches the named detail and queue, displays CONFIRMED and leaves other incident detail alone.
- Cadence Postgres regression reads the real claim join before/after SOS, verifies incident.changed
  after ingestion, and retains the existing no-duplicate-alert assertion. No data reset or migration.
- Accepted message spec, design prose and dispatcher task note updated together. No diagram changed;
  course handbook PDF sections 1.4/1.5 reread before editing design prose.

## Verified results

Focused backend 2 suites/86 tests pass. Final backend coverage uses dispatcher and existing repository
tests: 2 suites/45 pass; changed production files have 100% lines, dispatcher 94.87% branches and
repository 100% branches. Focused frontend 2 files/40 tests pass; AlertBanner has 100% lines and
95.45% branches. The matching V8 reporter was installed in a new private ignore/hoangtk/coverage-tools
directory with a node_modules junction; no manifest or lockfile changed.

Full backend unit: 246 suites/2860 tests pass, one suite/test fails in the unchanged local Rentals
PDF renderer (247 suites/2861 total, 225.993 seconds). This is #311, explicitly accepted for delivery
by KhoaDD and green in #313/#314 Linux CI. Never a full local green claim. No Rentals code changed.
Fresh disposable Postgres: 43 suites/242 tests pass (132.308 seconds). Full HTTP: 21 suites/441 pass
(51.511 seconds). Gateway: 12 suites/90 pass. Workspace lint/typecheck/build exit 0; existing backend
unused-variable and frontend fast-refresh warnings remain. Boundaries pass: 563 files,55 owned models,
10 modules acyclic. Checksum selftest 61/61. Full frontend: 102 files/1123 tests pass
(305.38 seconds). Final focused rerun also covers a failed poll preserving the displayed text.

Initial new frontend test leaked fake timers into later tests; cleanup corrected and focused tests
pass. Initial new test assertion had an unsafe any lint error; replaced with a typed payload check,
lint passes. Initial standalone checker command used the workspace root instead of backend; corrected
to node backend/scripts/check-module-boundaries.js, which passes as does lint's boundary gate.

Current Codex turn metadata verifies gpt-6.1-sol. Commit must use that model through HoangTK's
unchanged Checksum hook. Both recovery stashes, unrelated backend/ignore/, private credentials and
existing local databases remain. New disposable DBs: treklink_suspected_20261102 (focused) and
treklink_suspected_gates_20261102 (full), on loopback port 55439. No shared Neon operation.

API_EVENT remains pending and outside this wording slice. No unrelated modules, Jira Done changes,
duplicate Daily Report or merge action. After submitting this PR, audit DoD 8.1 on latest dev and
deliver checklist changes separately, with only evidence-backed criteria checked.
