# 2026-10-30 09:03, KhoaDD under D-078, incidents listens to member.deactivated

## Why

Follow-up raised by TanNB in #130 and assigned by the leader on PR #120: under D-034 (REQ-EVT-11), an incident owned by a deactivated member goes back to `NOTIFY_BACKUP`. Built by the leader's cloud agent under D-078 on a new branch from `origin/dev`. The leader resealed it and opened PR #140; the review fix of the same day is under Review fix below. No PR opened and no GitHub comment posted from this session.

## Branch

| | |
|---|---|
| Branch | `feat/incidents-member-deactivated` (PR #140), rebased onto `origin/dev` `2dd1ea5` after #120 merged |
| Commits | the three resealed commits (feat listener, this file, demo endpoint), rebased with their `Checksum` trailers unchanged, and the review-fix commits on top, which carry no trailer and are to be sealed |
| Identity | Do Dang Khoa, no AI trailers |

## Built

- `incidents/listeners/owner-deactivation.listener.ts`: `@OnEvent(MEMBER_DEACTIVATED)` reads the member's `ACKNOWLEDGED` and `RESPONDING` incidents (`IncidentsRepository.ownedActive`) and moves each to `NOTIFY_BACKUP` as `SYSTEM` with `OWNER_DEACTIVATED`, one transaction per incident, recipients from `RoutingService.recipientsOf`: the organization's tiers (the member is already off the roster) plus the active TrekLink Staff and Admin. The lifecycle skips an empty tier, so with every tier empty the incident reaches `ESCALATED` and Staff and Admin are alerted (REQ-EVT-04). A raced move (`STALE_VERSION`, `INVALID_STATE_TRANSITION`) is skipped; any other failure, including the read, is logged, and the status deadline still escalates the incident (REQ-EVT-07).
- Registered in `IncidentsModule`. The event import from `auth` uses the Figure 3 edge `INC --> AUTH`, which `dev` has since #120; the branch adds no second line.

## Checks, first version (on `2d99717` plus the listener, before the review fix)

| Gate | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 1 warning (predates the branch); boundary check passed, 341 files, 9 modules, acyclic |
| `jest` | 148 suites, 1606 passed (listener spec: 5 cases; repository read spec: 1 case) |
| `test:e2e` | 13 suites, 181 passed |
| `test:db` on a disposable local Postgres 16 | 11 suites, 74 passed; `incidents-owner-deactivation.db-spec.ts` walks ACKNOWLEDGED to NOTIFY_BACKUP, alerts the backup only, and a repeated event moves nothing |

## Review fix (2026-10-30, review of PR #140)

- Blocker: the listener called `routing.route()`, whose Staff list is `NO_STAFF`, so an all-empty cascade reached `ESCALATED` with nobody alerted. It now calls `recipientsOf(organizationId, now, tx)`; `ownedActive` no longer selects `contractId`.
- `incidents-owner-deactivation.db-spec.ts`: one organization per case; an `ACKNOWLEDGED` owner to `NOTIFY_BACKUP` with the backup alerted, a `RESPONDING` owner past an empty backup to `NOTIFY_MANAGER` with the Manager alerted, and every tier empty to `ESCALATED` with Staff and Admin alerted.
- `mf03-escalation.db-spec.ts`: a soft-deleted Staff account, still flagged active, gets no alert.
- `authority-reports.db-spec.ts` did not compile on `dev` (the `RoutingService` and `DevicesService` constructors gained arguments); its two constructor calls are fixed so `test:db` runs.
- Checks after the fix, on `2dd1ea5` plus the branch: `tsc --noEmit` exit 0; lint 0 errors, 1 warning (predates the branch), boundary check passed (368 files, 9 modules, acyclic); `jest` 157 suites, 1737 passed; `test:e2e` 14 suites, 213 passed; `test:db` on a local Postgres 16, 13 suites, 81 passed.

## Spec changes

- `specs/platform/design.md` Figure 3: no change against `dev`, which already has `INC --> AUTH`.
- `specs/incidents/tasks.md` 4.2: dated "Partly done" line for the listener. Staff false alarm from `UNROUTED` stays open.

## Shared files touched

`incidents/incidents.module.ts`, `incidents/incidents.repository.ts` (and its read spec). No migration, catalog, seed, router or navigation change.

## Decision applied

The leader ruled on 2026-10-30 that `ESCALATED` alerts every active TrekLink Staff and Admin account (incidents design §3, merged with #120). The listener follows it through `recipientsOf`.

## Not done

Staff false alarm from `UNROUTED` (rest of 4.2). The listener is not retried if the process stops between the deactivation commit and the event.

## Demo steps

1. As `operator@treklink.local`, acknowledge a fresh SOS (`npm --prefix backend run replay:mqtt -- sos --now --new-ids`) at `/o/incidents/<id>`.
2. As `manager@treklink.local`, `POST /api/organizations/:id/members/:memberId/deactivate` (the `/o/members` page is not built yet).
3. The incident shows `NOTIFY_BACKUP` with no owner, history reason `OWNER_DEACTIVATED`; the backup (or, with no backup on the shift, the Manager tier) is alerted.
