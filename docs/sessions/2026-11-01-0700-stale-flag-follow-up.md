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

## Item 4: the REQ-EVT-12 alert (branch `fix/stale-flag-alert`)

Leader ruling of 2026-11-01: option 1, outbox rows (REQ-UBI-04, REQ-EVT-13). Stacked on
`fix/stale-flag-follow-up` and held until after the demo, because it touches the alert dispatcher on the
MF-03 path. MSG40 "Device silent: {device} ({holder}), last heard {time}."; recipients the owner when
set, else the current tier's members through routing, else, for `ESCALATED`, `UNROUTED` and `REPORTED`,
every active TrekLink Staff and Admin account; one alert when the flag is set, none when it clears; the
banner shows it without Acknowledge.

| Part | Where |
|---|---|
| `alert_deliveries.kind` (`TRANSITION`, `STALE`), nullable `transitionId`, `lastSeenAt`, CHECK `alert_deliveries_kind_shape` | migration `20261101190000_incidents_stale_alert`, `schema.prisma` |
| `StaleAlerts.queue` and `RoutingService.treklinkRecipients` | `incidents/alerts/stale-alerts.ts`, `routing.service.ts`, called from `IncidentsService.markDeviceStale` |
| MSG40 and `kind` on `incident.alert`, one body per row | `alerts/alert-dispatcher.job.ts`, ws-live-contract |
| Banner: Dismiss in place of Acknowledge, SOS kept ahead | `frontend/src/app/AlertBanner.tsx` |

Decisions taken here, for review:

- The text needs the last reading, which the dispatcher cannot read back once the device is heard
  again, so the row stores it in `lastSeenAt` (a column beyond the ruling's "kind column").
- A `STALE` banner leaves on Dismiss or when the incident reaches `RESOLVED`, `FALSE_ALARM` or
  `CLOSED`. `incident.changed` carries no `stale` field, so a flag clear does not remove it.
- An owned `RESOLVED` incident in its reopen window alerts its owner, as the ruling's order reads; an
  ownerless `FALSE_ALARM` alerts nobody.
- The repository has no message catalog file (the SRS §5.3 catalog lives outside it), so MSG40 is
  recorded in incidents and frontend requirements, incidents design §3 and the dispatcher's `msg40`.
- `AlertDeliveryView` (api-design 14, the delivery log) does not show `kind`; a STALE row appears as one
  more WEB or WEBSOCKET row of its tier.
