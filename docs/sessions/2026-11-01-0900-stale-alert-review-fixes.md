# 2026-11-01 09:00: review fixes on #237 (device-silent alert)

KhoaDD under D-078, run by the leader's cloud agent. Branch `fix/stale-flag-alert`, rebased onto
`origin/dev` at `f143f54` and pushed with `--force-with-lease` (allowed for this branch). Scope: the
blocking item, two suggestions and the `tierOf` nit of the #237 review.

## Done

| Item | Where |
|---|---|
| A `RESOLVED` or `FALSE_ALARM` incident alerts nobody, owner or not, checked before the owner; the flag is still set | `incidents/alerts/stale-alerts.ts`, incidents REQ-EVT-12, design §3, `test/incident-stale-flag.db-spec.ts` |
| Staff get Dismiss beside Open queue on a `STALE` alert; an SOS still offers the queue only | `frontend/src/app/AlertBanner.tsx`, frontend REQ-EVT-05 |
| The delivery log carries `kind`; the incident page names a `STALE` row "Device silent" | `incidents.repository.ts`, `AlertDeliveryView`, `IncidentHistory.tsx`, api-design 14 regenerated |
| `StaleAlerts` reuses `isTier`, `tierOf` and `tierMembers` of `incident-lifecycle.ts` | both files |

## Facts confirmed

- The rebase kept the `Checksum:` lines of the three original commits; they now sit on new parents.
- The workspace hoists dependencies to the root `node_modules`; two `npm ci` runs in `backend/` and
  `frontend/` at once leave both trees broken. Install once at the root.

## Open

- `incident.changed` carrying `stale`, so the banner can drop an alert when the flag clears (review
  follow-up, not asked here).
- The review nit on `feat:` commits on a `fix/` branch: the commit messages were not reworded.
