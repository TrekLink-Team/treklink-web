# 2026-11-01 07:00: stale flag follow-up of #233 (task W13)

KhoaDD under D-078, run by the leader's cloud agent. Branch `fix/stale-flag-follow-up` from `origin/dev`
at `6c530d5`. Scope: the review suggestions 1 to 3 of treklink-web #233; the REQ-EVT-12 alert is asked,
not built.

## Done

| Item | Where |
|---|---|
| A marked device still stale asks `markDeviceStale(true)` on every run, so an incident opened after the mark (a queued SOS relayed late) is flagged | `monitoring/jobs/stale-sweep.job.ts` `keepFlag`, monitoring design §3 |
| A mark removed without an entry (reset, device gone, handed over after it was heard again) is deleted in one transaction with `markDeviceStale(false)`; a device handed over while still silent keeps its flag | `stale-sweep.job.ts` `releaseDevice`, `IncidentsService.markDeviceStale` takes a null `lastSeenAt`, incidents design §5, `test/stale-sweep.db-spec.ts` |
| The stale part of the monitoring 2.4 Status line removed; the `pruneStream` sentence kept | `specs/monitoring/tasks.md` |

## Facts confirmed

- `alert_deliveries.transitionId` is NOT NULL with a foreign key to `incident_transitions`, and the
  dispatcher builds MSG31 for every row (`alert-dispatcher.job.ts` `payloads`). A stale alert row cannot be
  written without a schema change or a transition row.
- `AlertBanner` keys alerts by incident and drops one on an `incident.changed` whose state is not
  actionable, so an owner of an `ACKNOWLEDGED` incident would lose a stale banner at the next change.
- Recipients come from the caller (`reason.recipients`, routing), not from the lifecycle.

## Open

The REQ-EVT-12 alert (incidents tasks 4.4): options asked to the leader in the session chat.
