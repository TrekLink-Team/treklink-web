# 2026-10-30 09:03, KhoaDD under D-078, incidents listens to member.deactivated

## Why

Follow-up raised by TanNB in #130 and assigned by the leader on PR #120: under D-034 (REQ-EVT-11), an incident owned by a deactivated member goes back to `NOTIFY_BACKUP`. Built by the leader's cloud agent under D-078 on a new branch from `origin/dev`. No PR opened, no GitHub comment posted.

## Branch

| | |
|---|---|
| Branch | `feat/incidents-member-deactivated`, from `origin/dev` `2d99717` |
| Commits of this session (seal these only) | `0f939f1` feat: return an incident of a deactivated owner to NOTIFY_BACKUP (D-034); and the commit that adds this file |
| Identity | Do Dang Khoa, no trailers, no `Checksum` |

## Built

- `incidents/listeners/owner-deactivation.listener.ts`: `@OnEvent(MEMBER_DEACTIVATED)` reads the member's `ACKNOWLEDGED` and `RESPONDING` incidents (`IncidentsRepository.ownedActive`) and moves each to `NOTIFY_BACKUP` as `SYSTEM` with `OWNER_DEACTIVATED`, one transaction per incident, recipients from `RoutingService.route` (the member is already off the roster). An empty backup tier is skipped by the lifecycle. A raced move (`STALE_VERSION`, `INVALID_STATE_TRANSITION`) is skipped; any other failure, including the read, is logged, and the status deadline still escalates the incident (REQ-EVT-07).
- Registered in `IncidentsModule`. The event import from `auth` needs the Figure 3 edge `INC --> AUTH`, the same line #120 adds, so the two branches agree on it.

## Checks, on `2d99717` plus `0f939f1`

| Gate | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 1 warning (predates the branch); boundary check passed, 341 files, 9 modules, acyclic |
| `jest` | 148 suites, 1606 passed (listener spec: 5 cases; repository read spec: 1 case) |
| `test:e2e` | 13 suites, 181 passed |
| `test:db` on a disposable local Postgres 16 | 11 suites, 74 passed; `incidents-owner-deactivation.db-spec.ts` walks ACKNOWLEDGED to NOTIFY_BACKUP, alerts the backup only, and a repeated event moves nothing |

## Spec changes

- `specs/platform/design.md` Figure 3: `INC --> AUTH` (also on #120; identical line).
- `specs/incidents/tasks.md` 4.2: dated "Partly done" line for the listener. Staff false alarm from `UNROUTED` stays open.

## Shared files touched

`incidents/incidents.module.ts`, `incidents/incidents.repository.ts` (and its read spec). No migration, catalog, seed, router or navigation change.

## Open decision

Incidents design §3 says `ESCALATED` alerts "every TrekLink Staff and Admin"; D-079 says active Staff accounts. Staff only is built on #120 and stays so until the leader rules; this branch does not touch it.

## Not done

Staff false alarm from `UNROUTED` (rest of 4.2). The listener is not retried if the process stops between the deactivation commit and the event.

## Demo steps

1. As `operator@treklink.local`, acknowledge a fresh SOS (`npm --prefix backend run replay:mqtt -- sos --now --new-ids`) at `/o/incidents/<id>`.
2. As `manager@treklink.local`, deactivate that Operator on the organization members page.
3. The incident shows `NOTIFY_BACKUP` with no owner, history reason `OWNER_DEACTIVATED`; the backup (or, with no backup on the shift, the Manager tier) is alerted.
