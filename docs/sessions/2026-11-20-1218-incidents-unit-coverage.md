# TK-219 incidents unit coverage

Session: 2026-11-20, Asia/Saigon. Base: `dev` at `1d012cb3`. Branch: `test/incidents-unit-coverage`.

Added 29 unit tests in nine spec files, using the existing Jest repository and service doubles. The module now runs 614 tests across 23 suites, up from 585 tests across 22 suites. Production code and `specs/` are unchanged.

## Coverage measurement

The requested command was run from `backend/`:

```sh
npx jest --runInBand --coverage --collectCoverageFrom='src/modules/incidents/**/*.ts' src/modules/incidents
```

The initial attempt encountered stale installed dependencies and a stale generated Prisma client. After `npm ci` and `prisma generate`, all 585 existing tests passed, but the requested glob collected zero files: Jest already uses `rootDir: "src"`. The baseline and final measurements below use the root-relative glob and an explicit test filter:

```sh
npx jest --runInBand --coverage --collectCoverageFrom='modules/incidents/**/*.ts' --coverageReporters=text --coverageReporters=json --coverageReporters=json-summary --testPathPattern=src/modules/incidents
```

Baseline files below 80% lines or branches: `incident-device-groups.ts` (100% lines, 60% branches), `listeners/owner-deactivation.listener.ts` (100% lines, 75% branches), and `index.ts` (0% lines, 100% branches). No files remain below either threshold.

Paths below are relative to `backend/src/modules/incidents/`. Percentages are lines/branches.

| File                                         | Before L/B      | After L/B     |
| -------------------------------------------- | --------------- | ------------- |
| `alert-deliveries.repository.ts`             | 100/100         | 100/100       |
| `authority-reports.controller.ts`            | 100/100         | 100/100       |
| `authority-reports.repository.ts`            | 100/100         | 100/100       |
| `authority-reports.service.ts`               | 100/100         | 100/100       |
| `display-time.ts`                            | 100/100         | 100/100       |
| `incident-device-groups.ts`                  | 100/60          | 100/100       |
| `incident-ingress.ts`                        | 100/100         | 100/100       |
| `incident-lifecycle.ts`                      | 100/99.28       | 100/99.28     |
| `incidents-ports.module.ts`                  | 100/100         | 100/100       |
| `incidents-query.service.ts`                 | 98.92/96.05     | 100/100       |
| `incidents.controller.ts`                    | 100/100         | 100/100       |
| `incidents.module.ts`                        | 100/100         | 100/100       |
| `incidents.repository.ts`                    | 90.41/100       | 100/100       |
| `incidents.service.ts`                       | 100/100         | 100/100       |
| `index.ts`                                   | 0/100           | 100/100       |
| `response-times.ts`                          | 100/84.61       | 100/84.61     |
| `routing.service.ts`                         | 100/100         | 100/100       |
| `alerts/alert-dispatcher.job.ts`             | 100/95.34       | 100/100       |
| `alerts/alert-events.ts`                     | 100/100         | 100/100       |
| `alerts/stale-alerts.ts`                     | 100/100         | 100/100       |
| `jobs/incident-timers.job.ts`                | 100/100         | 100/100       |
| `listeners/owner-deactivation.listener.ts`   | 100/75          | 100/100       |
| `ports/incident-events.port.ts`              | 100/100         | 100/100       |
| `providers/contract-close-check.provider.ts` | 100/100         | 100/100       |
| `providers/organization-count.provider.ts`   | 100/100         | 100/100       |
| **Total**                                    | **98.39/97.37** | **100/99.34** |

The query tests use the public incidents entry point, exercising `index.ts`. The remaining branch counters cover defensive owner-id validation in the lifecycle and nullable organization fallbacks in response-time sorting. Existing routing, ingress, timer, status-update, authority-report and access checks already had high coverage; new tests also strengthen lifecycle reason validation, timer race handling and failure propagation.

## Break-the-code checks

Each new describe block was run alone against a temporary production mutation. Each produced an assertion failure, then passed after the original source was restored. No mutation is committed. A first lifecycle mutation produced a TypeScript error and was discarded; only the subsequent assertion failure is counted here.

| New describe block                            | Temporary break                                        | Result                          |
| --------------------------------------------- | ------------------------------------------------------ | ------------------------------- |
| `incidentDeviceGroups tenant boundaries`      | Allow unrouted devices into the group lookup           | Assertion failed; restored pass |
| `deactivation failure isolation`              | Log Error objects with String instead of their message | Assertion failed; restored pass |
| `missing directory labels`                    | Replace a missing author name with the account id      | Assertion failed; restored pass |
| `demo escalation choices`                     | Return an empty demo choice list                       | Assertion failed; restored pass |
| `explicit incident ordering and demo options` | Sort the state column by code                          | Assertion failed; restored pass |
| `defensive alert fallbacks`                   | Use the Unix epoch for a missing STALE reading time    | Assertion failed; restored pass |
| `status update persistence failures`          | Swallow a status deadline write failure                | Assertion failed; restored pass |
| `authority report persistence failures`       | Swallow a report closure write failure                 | Assertion failed; restored pass |
| `reason-specific lifecycle table`             | Bypass the lifecycle edge table for ROUTED             | Assertion failed; restored pass |
| `response and close timer races`              | Log a lost timer race as an unexpected failure         | Assertion failed; restored pass |

## Issue 471

The lost-wake fix from #480 is already present in the requested base. Previously, SerialRunner cleared its active run in a promise finally reaction, leaving a microtask window after the last rerun check. A new after-commit wake could see the finished run as active, set the rerun flag after the loop stopped reading it, and leave the committed alert waiting for the two-second cron. The current loop clears active synchronously with completion of its final rerun check.

No additional production fix was needed. The existing 16 microtask timing cases pass. `incident-alert-socket.db-spec.ts` passed twice on local Postgres 16 using a separate migrated disposable database, five tests per run. Both runs retained the 2000 ms p95 bound, including after-commit delivery with both dispatcher crons stopped, scoped reconnects, authentication and rollback assertions. The GitHub issue remains open for its existing CI observation period; no issue state was changed.

## Validation and limits

- Module coverage: 23 suites, 614 tests passed.
- Prettier write and check: all nine touched spec files passed.
- ESLint: all nine touched spec files passed.
- `npm run typecheck`: full backend `tsc --noEmit` passed, including the touched specs.
- `npm run lint:boundaries`: passed, 667 files, 65 models, 10 modules, acyclic graph.
- Socket database suite: two runs, five tests passed each.
- `git diff --check`: passed.

No requested check was blocked. CI runner load was not reproduced locally. An exploratory coverage invocation accidentally selected the wider backend suite because an array-valued reporter option consumed its positional filter; it was stopped, and unrelated handover PDF-parser failures from that run were not investigated. The reported before/after measurements both use the explicit incidents-only filter above.

Delivery is a branch push only. No pull request, merge, or push to dev/main is part of this task.
