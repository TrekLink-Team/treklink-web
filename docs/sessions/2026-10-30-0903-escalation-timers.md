# 2026-10-30 09:03, KhoaDD under D-078, TK-144 escalation timers finished

## Why

Finishes incidents task 3.1 on draft PR #120 (HoangTK) after the leader rulings posted on the PR: the Staff alert on `ESCALATED` (D-079) and the restart-test ruling. Built by the leader's cloud agent under D-078. No PR opened, #120 not marked ready, no GitHub comment posted.

## Branch

| | |
|---|---|
| Branch | `feat/TK-144-escalation-timers`, pushed fast-forward on HoangTK's `ebf81e1`; not rebased, #120 merges cleanly into `dev` |
| Commits of this session (seal these only) | `13b32d2` feat: alert the active TrekLink Staff when an incident escalates (D-079); `ba5bfe2` docs: tick incidents 3.1 with the Staff recipients and the restart-test ruling; and the commit that adds this file |
| HoangTK's commits | `364d8de`, `2a48ec9`, `e798899`, `69917a2`, `ebf81e1`, already sealed by him; not rewritten |
| Identity | Do Dang Khoa, no trailers, no `Checksum` |

## Built

- `auth`: `AccountsService.activeStaffIds(tx?)` over `AccountsRepository.activeStaffIds`, the ids of active, not deleted `TREKLINK` accounts holding the `STAFF` role.
- `incidents`: `RoutingService.recipientsOf` reads it inside the timer's transaction in place of `NO_STAFF`, so the lifecycle writes one alert row per Staff member and channel on `ESCALATED` (MSG34). `IncidentsModule` imports `AuthModule`. `route()` still gives `UNROUTED` no Staff (task 2.2).
- RESOLVED or FALSE_ALARM to CLOSED after `incidents.reopenWindowMinutes` was already in the PR (`closeAfterReopenWindow`); nothing added.

## Checks, on `ebf81e1` plus this session's commits

| Gate | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 1 warning (predates the branch); boundary check passed, 287 files, 9 modules, acyclic |
| `jest` | 122 suites, 1363 passed |
| `test:e2e` | 12 suites, 166 passed |
| `test:db` on a disposable local Postgres 16 | 7 suites, 54 passed; `mf03-escalation.db-spec.ts` checks the Staff rows and that an inactive Staff account is left out |

## Spec changes

- `specs/platform/design.md` Figure 3: `INC --> AUTH`.
- `specs/incidents/tasks.md`: 3.1 ticked, note records D-079 and the restart-test ruling (db spec accepted for platform AC-09 and REQ-ERR-04, no boot, stop and reboot test); 2.2 gets a dated "Partly done" line.

## Shared files touched

`auth/accounts.service.ts`, `auth/accounts.repository.ts` (and their specs), `incidents/incidents.module.ts`, `incidents/repositories.spec.ts`, `test/mf03.db-spec.ts`. No migration, catalog, seed, router or navigation change.

## Open decision

Incidents design §3 says `ESCALATED` alerts "every TrekLink Staff and Admin"; D-079 says active Staff accounts. Staff only is built and stays so until the leader rules. Options: (1) Staff only, edit design §3 to match D-079 (recommended); (2) Staff and Admin, widen the read to the `ADMIN` role.

## Not done

Staff recipients of `UNROUTED` (task 2.2).

## Demo steps (run book MF-03)

1. As `admin@treklink.local`, `PATCH /api/parameters/:key` (the Parameters page is not built): set `incidents.primaryAckTimeoutSeconds`, `incidents.backupAckTimeoutSeconds` and `incidents.managerAckTimeoutSeconds` to `30` (their minimum), and `incidents.reopenWindowMinutes` to `5` (its minimum).
2. `npm --prefix backend run replay:mqtt -- sos --now --new-ids`; leave it unacknowledged about 2 minutes.
3. `staff@treklink.local` gets MSG34; `/t/incidents` lists it.
4. As `operator@treklink.local` at `/o/incidents/<id>`: acknowledge, post a status, resolve.
5. About 5 to 6 minutes later it shows `CLOSED`.
