# 2026-11-02: the field simulation of the demo panel (SIM-1, specs/demo Phase 5)

Under D-078, for D-093 amendment and D-094. Branch `feat/demo-field-simulation`, cut from
`docs/demo-simulation-panel` (draft treklink-web#303) and rebased on `origin/dev` at `880c596`. Last code
commit before this report: `82a4a4f`.

## Commits

`6316be9` spec 5.1; `f0b2867` migration, permission, flag 5.2; `83aad04` gateway-sync 5.3; `51d3292`
incidents and monitoring 5.4; `4d3af1e` demo routes 5.5; `a40666c` db-spec 5.6; `ef11194` frontend 5.7;
`82a4a4f` trail fetch script.

## Built

`simulated_nodes` with `FieldSimulationService` (gateway-sync, exported) and pure position, battery and
beacon functions; the simulator job reads the table while `DEMO_SIMULATION_ENABLED` is on; `UplinkIngress`
`{ simulated: true }`; `simulated` on field events, incidents, the map snapshot and the organization device
list; `DemoSimulationModule` with routes 06 to 10, `demo.simulate` and the loopback-or-`treklink_prod`
check; screen 7.5 section "Field simulation" and Simulated badges on the maps and incidents.

## Checks (all on this branch)

Backend lint and boundary check pass, `tsc` clean, unit 244 suites / 2786 tests, e2e 20 / 431, db-spec on a
fresh local Postgres 16: 40 suites / 234 tests (the new `demo-simulation.db-spec.ts` 4 of 4). Frontend lint
(one older warning), typecheck clean, 99 files / 1077 tests.

## Spec changes

Design §9: `beaconedUntil`, `databaseAllowed` on route 06, the speed rule exemption for simulated positions,
`FieldSimulatorModule` loaded by either flag, 400 `VALIDATION_FAILED`. Gateway-sync, incidents and monitoring
design notes; incidents and monitoring samples gain `simulated`.

## Shared files touched

`schema.prisma`, migration `20261102120000_simulation`, `catalog.py` and `permission-matrix.md`,
`error-code.enum.ts`, `environment-variables.ts`, `.env.example`, `app.module.ts`, `gateway-sync.module.ts`,
`navigation.ts` (comment), `AppShell.tsx`. Seed, router: unchanged.

## Not done

Task 5.3 holds one trail: the network policy refused the Overpass API, so two trails wait for
`node backend/scripts/fetch-osm-trail.js`. Task 5.8 (AC-08 on the staging). No PR opened.

## Demo steps

Backend: `DEMO_SIMULATION_ENABLED=true` (on Vercel also `JOBS_TICK_ON_REQUEST=true`).

1. `admin@treklink.local`: Administration, Demo control. Add node: TL-0010, Ta Nang to Phan Dung, Walk, Add node.
2. `operator@treklink.local`, second window: Live map. Within two minutes TL-0010 (Simulated) moves.
3. Admin: TL-0010 row, SOS, Send SOS. Operator: Incidents shows the incident with Simulated; acknowledge.
4. Admin: Cancel SOS. `manager@treklink.local` or the operator resolves the incident.
5. Admin: Pattern Silent, Apply; after five minutes the map shows TL-0010 Offline. Walk, Apply clears it.
6. `staff@treklink.local`: Incidents lists it with Simulated.
