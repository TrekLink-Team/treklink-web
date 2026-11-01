# 2026-11-01 09:00: cadence-inferred incident (task W16, incidents REQ-EVT-02)

KhoaDD under D-078, run by the leader's cloud agent. Branch `feat/cadence-inferred-incident` from
`origin/dev` at `dcd5cfe`. Scope: `SUSPECTED` creation from `CADENCE_INFERRED` in `onPosition`, its
tests, and the demo check. The SOS path (`onSos`, routing, alerts) is unchanged except one
`incident.changed` emitted when an SOS upgrades a `SUSPECTED` incident.

## Done

| Item | Where |
|---|---|
| Cadence count under a device advisory lock, by occurrence time, both window edges, window containing the position, only positions after the device's last `closedAt` | `incidents/incident-ingress.ts` (`onPosition`, `cadence`, `cadenceBurstStart`), `incidents.repository.ts` (`lockDeviceCadence`, `lastClosedAt`) |
| Creation and routing as an SOS: `DETECTED`, then `ROUTED` by the position's attribution; tier alerts of design §3 | `openSuspected` in `incident-ingress.ts` |
| gateway-sync answers the count over its own `field_events`; `PositionEvent` carries `eventId` and the attribution | `gateway-sync/ingestion.repository.ts` `plottedPositionTimes`, `ingestion.service.ts` |
| `incident.changed` after commit when an SOS upgrades `SUSPECTED` to `CONFIRMED` | `append` in `incident-ingress.ts` |
| Spec | incidents design §4 "Cadence" and §5, gateway-sync design §2 step 4, incidents tasks 2.3 dated line |

## Facts confirmed

- `field_events` is owned by `gateway-sync`, and `gateway-sync --> incidents` is an edge, so an
  `incidents` read of positions would be a cycle; the read is passed in by the caller instead.
- No device row lock exists before `onPosition` for an older fix (`projectIfNewer` matches only a newer
  one), so the cadence path takes its own advisory lock.
- Simulator (`gateway/src/serial/simulator.ts`, `GATEWAY_SIM_INTERVAL_MS` default 5000): one position
  per node every 5 s, device time in whole seconds, so 12 to 13 positions in any 60 s window. With the
  seeded `incidents.cadenceCount` 6 and `incidents.cadenceWindowSeconds` 60, TL-0009 and TL-0010 each
  open a `SUSPECTED` incident about 25 s after the gateway starts, and the MF-03 TL-0010 SOS then joins
  that incident instead of opening a new one.
- Trek replay fallback (`backend/test/fixtures/mqtt/trek.json`): 30 s apart in device time, so at most 3
  in 60 s; it does not reach the count. `--interval 2000` changes arrival spacing, not occurrence time.

## Checks

Local Postgres 16 (`localhost`, not Neon): all 31 db suites pass, 192 tests, including
`incidents-cadence.db-spec.ts` (run 6 times, no flake), `mf03.db-spec.ts`, `mf03-escalation.db-spec.ts`.
Unit: 209 suites, 2360 tests. `npm run lint` (eslint and boundary check) and `tsc --noEmit` clean.

## Open

- Demo guard (with this branch merged): options asked to the leader in the session chat; the demo seed
  and the demo script are unchanged.
- Alert text of a `SUSPECTED` incident: MSG31 reads "SOS: ..."; options asked to the leader.
- Task 2.3 still open: tagging positions stored before the SOS arrived.
