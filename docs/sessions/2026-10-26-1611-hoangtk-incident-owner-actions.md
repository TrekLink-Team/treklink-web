# HoangTK incident owner actions (task 4.1), 2026-10-26

## Approved scope

- Incidents task 4.1 as a service only: acknowledge, responding, status update, resolve. No controller (6.1), no response presenter (5.1), no migration, no dependency. Branch `feat/TK-142-incident-owner-actions` from dev `02a676b`, after PR 66 merged.
- Rulings approved by HoangTK before implementation:
  1. The methods return the updated `Incident` row; device, holder and owner-name enrichment belongs to the presenter of tasks 5.1 and 6.1.
  2. A status update moves `statusDueAt` and leaves `version` unchanged, so the owner's `expectedVersion` for resolve stays valid.
  3. A status update emits `incident.changed` and `audit.record` (`incident.status_update`) after commit and adds no outbox row; the organization API stream for status notes belongs to the dispatcher, task 2.1.
  4. The acknowledge note (optional) and the responding note (required, api-design 04) are stored on the transition row; neither creates a status-update row.
  5. MSG27 waits for auth 5.2 `contactCard` (PR 78). Until then the loser gets the lifecycle's generic `ALREADY_OWNED` text, and 4.1 stays unticked with a note in `tasks.md`. The MSG27 time will come from the latest `ACKNOWLEDGED` transition row, because the lifecycle keeps the first `acknowledgedAt` on an escalation takeover.
  6. The branch carries TK-142, the key used for task 1.2.

## Implementation

- `IncidentsService` locks the incident, answers 404 for a missing or other-organization incident, and passes the locked state with the request time and empty recipients to `IncidentLifecycle.apply`. These edges enqueue only the API event row, so no roster input is needed. A concurrent acknowledgement loser waits on the row lock, then reads the winner's owner and receives `ALREADY_OWNED`.
- A TrekLink account (no organization on the `Caller`) is refused with 403 `FORBIDDEN`. Blank required notes are refused with 400 `VALIDATION_FAILED` before a transaction opens.
- `addStatus` allows only `ACKNOWLEDGED` or `RESPONDING` (409 `INVALID_STATE_TRANSITION`), a member role (403 `FORBIDDEN`) and the owner (403 `NOT_OWNER`), in that order. An owner kept through a stale escalation acknowledges again before posting, as api-design 05 states.
- `IncidentsRepository` gains `insertStatusUpdate` and `resetStatusDue`. `IncidentsModule` registers the service without exporting it.

## Verification

- Incident unit suites: 236 tests passed; `incidents.service.ts` and `incidents.repository.ts` 100% statements, branches, functions and lines.
- Full backend: 59 unit suites, 707 tests passed; 8 HTTP/replay e2e suites, 56 tests passed. Lint and the acyclic module-boundary check, typecheck, build and Prettier passed.
- Postgres: 3 suites, 39 tests passed on a disposable Postgres 16 container with explicit URLs, migrations applied there only. New cases: AC-03 concurrent acknowledgement through the service; status update without a version bump followed by resolve on the same version; a kept owner's status update in `ESCALATED` refused with nothing written. The container was removed afterwards. Neon was not touched.
- `scripts/specs/check_tasks.py` reports 0 gaps, run with the Python interpreter the commit hook uses.
