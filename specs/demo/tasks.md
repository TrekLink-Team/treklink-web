# Implementation Tasks: demo

> Fulfills `design.md`; endpoints are `api-design/01` to `05`, the screen is
> `specs/frontend/ui-design/7-5-demo-control-panel.md`. D-088, built 2026-11-01 by KhoaDD under D-078.

| | |
|---|---|
| Lane owner | KhoaDD |
| Sprint | demo of 2026-11-01 |
| Depends on | platform, auth, organizations, devices, billing, rentals, incidents, gateway-sync |

## Phase 1: Spec and configuration

- [x] 1.1 This suite, api-design 01 to 04 from `scripts/specs/endpoints/demo.py`, screen 7.5, route in frontend design §2, `DEMO` edges in platform design Figure 3
- [x] 1.2 `DEMO_CONTROLS_ENABLED` (default `false`) in `environment-variables.ts`, platform requirements §4 and `.env.example`
- [x] 1.3 Forward migration `20261101120000_demo_controls`: auth event `DEMO_SWITCH`, permissions `demo.stage`, `demo.switchRole`, `demo.switchRole.org`; catalog rows and the regenerated permission matrix

## Phase 2: Backend

- [x] 2.1 Guards and lock (design §2); unit tests for production, a Neon host, loopback variants and busy
- [x] 2.2 Reset repository (design §3) and the seed runner (§4); `seed-demo.ts` exports `readPasswords`, the CLI unchanged
- [x] 2.3 Exported commands: `DemoSessionService` (auth), `OrganizationOnboardingService` export, `ContractDecisionsService`, `TermRolloverJob`, `ContractsService.byCode` and `endOpenTermAt` (rentals), `InvoicesService.firstChargeableInvoice` (billing), `DevicesService.byAssetTag` and `scheduleService`, `MaintenanceService` export (devices), `UplinkIngress` (gateway-sync), `IncidentsQueryService.openByDevices` (incidents, already exported); `rolloverTermEnd` and `tomorrowBusinessDay` move to `src` and `demo-term-end.ts` imports them
- [x] 2.4 Scenarios (design §5) with unit tests of each scenario's service calls; controller policy tests
- [x] 2.5 `test/demo-controls.db-spec.ts`: stage `clean`, `contract-ready-for-handover`, `term-ended` on Postgres

## Phase 3: Frontend

- [x] 3.1 `entities/demo` hooks; page `/t/admin/demo`; nav entry shown only while `enabled`; role switcher in the account menu; tests

## Phase 4: Sandbox test accounts (D-088 amendment of 2026-11-01, D-089)

- [x] 4.1 REQ-EVT-05 and AC-05, design §8, api-design 05 from `scripts/specs/endpoints/demo.py`, screen 7.5 box section
- [x] 4.2 `DEMO_TEST_ACCOUNTS_ENABLED` (D-089, default `false`) in `environment-variables.ts`, platform requirements §4 and `.env.example`; `DemoAccountsModule` with `DemoAccountsController` (`GET /api/demo/accounts`, `@Public()`, `Cache-Control: no-store`) and `DemoAccountsService`; `SEEDED_ACCOUNTS` export of `seed-demo.ts`; unit tests: the four accounts, production on a Neon host answers while the stage refuses, both flags off 404 everywhere, no password in a log call
- [x] 4.3 `entities/demo` `useDemoAccounts`, widget `TestAccountsBox` on `/` and `/sign-in`, Use fills the sign-in form or carries the account in route state; tests
- [x] 4.4 Compiled copy `demo-test-accounts.ts` read by the accounts service, no seed file, `ts-node` or `prisma/` at run time (design §8, leader decision 2026-11-01); drift test against the seed and an unloadable-seed test
- [ ] 4.5 Check the list on the Vercel production after its first deploy with `DEMO_TEST_ACCOUNTS_ENABLED=true`

## Phase 5: Field simulation (D-093 amendment, D-094, 2026-11-02; requirements §2.4, design §9)

- [x] 5.1 Spec: requirements §2.4 and AC-06 to AC-08, design §9 (this change); api-design 06 to 10 generated from `scripts/specs/endpoints/demo.py`; screen 7.5 section "Field simulation" in `specs/frontend/ui-design/7-5-demo-control-panel.md`; gateway-sync and incidents design notes for the `simulated` mark
- [x] 5.2 Migration `simulation`: `simulated_nodes`, `field_events.simulated`, `incidents.simulated`, permission `demo.simulate` for TrekLink Admin; `DEMO_SIMULATION_ENABLED` (default `false`) in `environment-variables.ts`, platform requirements §4, `.env.example`
- [ ] 5.3 gateway-sync: `trails.ts` (three or more OSM trails with provenance), the pure position, battery and beacon functions of design §9 with unit tests per pattern, `FieldSimulationService` (start, update, stop, event, list), the simulator job reading the table while the flag is on, `UplinkIngress` option `simulated`
  **Partly done** (2026-11-02, KhoaDD under D-078): everything except the trail count. `trails.ts` holds `ta-nang-phan-dung` only; the network policy of the build environment refused the Overpass API, so the two other trails wait for `node backend/scripts/fetch-osm-trail.js` run from a machine that reaches it (no coordinates typed from memory).
- [x] 5.4 incidents and monitoring: store and return `simulated` (incident from its opening event; device from its latest field event); unit tests
- [x] 5.5 demo: `DemoSimulationModule`, controller of api-design 06 to 10, the database check (loopback or `treklink_prod`), policy and audit; unit tests: Neon host refused, `treklink_prod` accepted with `NODE_ENV=production`, flag off 404
  **Review fixes** (2026-11-02, KhoaDD under D-078, treklink-web#307): the `treklink_prod` branch refuses `host`, `hostaddr`, `service`, `servicefile`, `dbname` and `database` in the query; the simulator job's `run` makes the same check; the monitoring `simulated` mark is clipped to the custody interval (D-040); the panel's rows have a row header and named actions.
- [x] 5.6 db-spec on Postgres: start, two runs store each packet once, `SOS` opens one simulated incident, `SILENT` turns stale, `SOS_CANCEL` stops beacons
- [x] 5.7 Frontend: section "Field simulation" on `/t/admin/demo`, "Simulated" badges on the live maps, device lists and incident header; tests; WCAG 2.2 AA per the UI standard
- [x] 5.9 Movement styles (leader ruling 2026-11-06, REQ-SIM-09, design §9.1)
  - **Done** (2026-11-06, KhoaDD under D-078, W33): `gateway-sync/simulator/field-styles.ts` holds the eight styles as pure functions of the anchor, the elapsed time and `styleSeed` (FNV-1a of `treklink-sim-v1:{assetTag}`, shifted to fit the signed column); `field-simulation.ts` uses them while the pattern walks and keeps the steady walk for a node with no style; a walking `STRAGGLER` sends nothing in its radio shadow. Migration `20261106090000_simulation_styles` adds `style` (nullable enum `SimulationStyle`) and `styleSeed`. Routes 06 to 08 list `styles`, take `style` and return it (api-design regenerated from `scripts/specs/endpoints/demo.py`); the panel has a style picker on Add node (default "From the asset tag", replacing the speed input) and a Style select with Apply on each row, stacked under the pattern. Tests: `field-styles.spec.ts` (each style's envelope with a fixed seed: fastest step, distance from the trail or anchor, rests, camp stay, group spread, shadow, battery, determinism, seed range), `field-simulation.service.spec.ts`, `demo-simulation.controller.spec.ts`, `FieldSimulationSection.test.tsx`; `test/demo-simulation.db-spec.ts` passes on a local Postgres 16 with the migration. Open: the speed question to the leader (styled nodes ignore `speedMetresPerMinute`)
- [ ] 5.8 AC-08 on the Vercel staging after the pin moves (D-094): a person runs AC-06 and AC-07 from the browser alone


## 6. W43 staging quick scenarios (2026-11-07, KhoaDD under D-078)

- [x] 6.1 Specify explicit environment gate, additive scenarios, provenance, time controls and screen contract (REQ-QUICK-01 to 09).
- [x] 6.2 Implement environment and Admin guard, durable counter and audited registry, preserve local-only reset and switching.
- [x] 6.3 Implement organization, four contract targets, SOS, loss/fault and walker refresh through owning services.
- [x] 6.4 Implement persistent escalation profile, contract and incident time controls with optimistic versions.
- [ ] 6.5 Build grouped WF-01 to WF-05 panel, result links, causes and synthetic/time disclosures.
- [ ] 6.6 Unit tests, quick contract/SOS Postgres specs, lint, typecheck, boundaries and visual/axe matrix.
- [ ] 6.7 Update demo script and run book to fresh scenario links and staging environment variables.

**Partly done** (2026-11-07, KhoaDD under D-078): W43 backend scenarios, guards and time controls are built. Local Postgres proves contract, SOS, profile restore, targeted rollover and escalation. Panel visual matrix and final docs delivery continue in the following slices.
