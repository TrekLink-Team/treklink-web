# 2026-10-30 09:03, KhoaDD under D-078, TK-144 escalation timers finished

## Why

Finishes incidents task 3.1 on draft PR #120 (HoangTK) after the leader rulings posted on the PR: the Staff alert on `ESCALATED` (D-079) and the restart-test ruling. Built by the leader's cloud agent under D-078. No PR opened, #120 not marked ready, no GitHub comment posted.

## Branch

| | |
|---|---|
| Branch | `feat/TK-144-escalation-timers`. This session pushed fast-forward on `ebf81e1`; HoangTK then rebased the branch onto `dev` `2d99717` and added three commits. The Admin change is pushed fast-forward on that head `33ef4dd` |
| Commits of this session (seal these only) | `bbc6f10` feat: alert the active TrekLink Staff when an incident escalates (D-079); `8145567` docs: tick incidents 3.1 with the Staff recipients and the restart-test ruling; `33ef4dd` docs: this file; and the commit on top that widens the alert to Admin (see Leader rulings). Shas as rebased by HoangTK; the pre-rebase `13b32d2`, `ba5bfe2`, `dc1b540` are gone |
| HoangTK's commits | `10d3802`, `48a6a05`, `c052069`, `e310820`, `f3e22bb`, `d23907d`, `21cf359`, `bf88119`, sealed by him; not rewritten by this session |
| Identity | Do Dang Khoa, no trailers, no `Checksum` |

## Built

- `auth`: `AccountsService.activeStaffAndAdminIds(tx?)` over `AccountsRepository.activeStaffAndAdminIds`, the ids of active, not deleted `TREKLINK` accounts holding the `STAFF` or `ADMIN` role.
- `incidents`: `RoutingService.recipientsOf` reads it inside the timer's transaction in place of `NO_STAFF`, so the lifecycle writes one alert row per Staff or Admin account and channel on `ESCALATED` (MSG34). `IncidentsModule` imports `AuthModule`. `route()` still gives `UNROUTED` no Staff (task 2.2).
- RESOLVED or FALSE_ALARM to CLOSED after `incidents.reopenWindowMinutes` was already in the PR (`closeAfterReopenWindow`); nothing added.

## Checks, on `ebf81e1` plus this session's first commits (before the upstream rebase)

| Gate | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 1 warning (predates the branch); boundary check passed, 287 files, 9 modules, acyclic |
| `jest` | 122 suites, 1363 passed |
| `test:e2e` | 12 suites, 166 passed |
| `test:db` on a disposable local Postgres 16 | 7 suites, 54 passed; `mf03-escalation.db-spec.ts` checks the Staff and Admin rows and that an inactive Staff account is left out |

## Spec changes

- `specs/platform/design.md` Figure 3: `INC --> AUTH`.
- `specs/incidents/tasks.md`: 3.1 ticked, note records D-079 and the restart-test ruling (db spec accepted for platform AC-09 and REQ-ERR-04, no boot, stop and reboot test); 2.2 gets a dated "Partly done" line.

## Shared files touched

`auth/accounts.service.ts`, `auth/accounts.repository.ts` (and their specs), `incidents/incidents.module.ts`, `incidents/repositories.spec.ts`, `test/mf03.db-spec.ts`. No migration, catalog, seed, router or navigation change.

## Leader rulings (2026-10-30, in the session chat)

- `ESCALATED` alerts every active TrekLink Staff **and Admin** account, as incidents design §3 stated before `bf88119`; design §3 is restored to name Admin (third bullet). D-079's wording ("active TrekLink Staff accounts") should be read that way; the decision register lives in `treklink-docs` and was not edited from here.
- An account whose invitation is not yet accepted (active, no password) is still alerted.
- incidents design §3 names Admin again; HoangTK's `bf88119` had narrowed it to Staff pending this confirmation.
- Checks after the change, on `33ef4dd` plus the Admin commit: `tsc` exit 0; lint 0 errors, boundary check passed (341 files, 9 modules); `jest` 148 suites, 1614 passed; `test:e2e` 13 suites, 181 passed; `test:db` on a local Postgres 16, 11 suites, 77 passed.

## Not done

Staff recipients of `UNROUTED` (task 2.2).

## Demo steps (run book MF-03)

1. As `admin@treklink.local`, `PATCH /api/parameters/:key` (the Parameters page is not built): set `incidents.primaryAckTimeoutSeconds`, `incidents.backupAckTimeoutSeconds` and `incidents.managerAckTimeoutSeconds` to `30` (their minimum), and `incidents.reopenWindowMinutes` to `5` (its minimum).
2. `npm --prefix backend run replay:mqtt -- sos --now --new-ids`; leave it unacknowledged about 2 minutes.
3. `staff@treklink.local` gets MSG34; `/t/incidents` lists it.
4. As `operator@treklink.local` at `/o/incidents/<id>`: acknowledge, post a status, resolve.
5. About 5 to 6 minutes later it shows `CLOSED`.
