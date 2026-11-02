# Requirements Specification: demo (local demo control panel)

**User Story**: As the **presenter of a TrekLink demo on a laptop**, I want to stage the starting state of each main flow on the local database from one button and switch the signed-in role in one click, so that a local demo needs no terminal.
**Story ID**: none, a demo aid outside the backlog (D-088) | **Priority**: High for the 2026-11-01 demo; the simulation of §2.4 High for the supervisor demo of 2026-11-06 | **Milestone**: Review demo, W9 supervisor demo

> **Authority**: D-093 amendment and D-094 of 2026-11-02 (a person runs every demo case from the browser, on the local stack or the Vercel staging, without an agent or a script; the simulation of §2.4), D-088 (demo control panel, treklink-docs register, merged 2026-11-01, amended 2026-11-01 with the test accounts list), D-089 (Vercel production; the test accounts list has its own flag and runs there), D-062 (the shared Neon database is never reset), D-078 (deadline takeover), D-057 (one account type per permission), D-002 (envelope). The manual procedure this module replaces is `docs/demo/2026-11-01-demo-script.md` §1.2, §1.3 and §8.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - A reset of the local database to the migration seed plus the demo seed (`backend/prisma/seed-demo.ts`)
  - Seven named scenarios, each a reset plus the steps that reach one flow's starting state through other modules' exported services
  - A role switch to the seeded account of a role, issuing a normal token pair
  - The Admin screen `/t/admin/demo` (screen 7.5) and a role switcher in the account menu
  - A controlled field simulation (D-093 amendment, 2026-11-02): an Admin picks devices, gives each a trail and a pattern, starts and stops them, and raises an SOS, a fall or a cancel on demand; the packets go through the normal ingestion path, so positions, staleness, incidents and alerts behave as for a real node, and everything they create is marked simulated
  - A public, read-only list of the seeded test accounts with their passwords, shown on `/` and `/sign-in` only while `DEMO_TEST_ACCOUNTS_ENABLED` is `true` (D-088 amendment of 2026-11-01, D-089)
- **Out-of-Scope**:
  - Any control panel action (status, scenarios, stage, role switch) against a shared or production database; the module refuses both. The test accounts list is the one exception: it reads no database (D-089)
  - New business rules: a scenario only calls services that already exist, or a small exported read or command added to the owning module
  - Loss cases (scenario 7 is listed as unavailable until treklink-web#228)
  - Real devices: the simulation of §2.4 drives seeded devices with synthetic stock packets; it never writes to a node
- **Depends on**: `platform`, `auth`, `organizations`, `devices`, `billing`, `rentals`, `incidents`, `gateway-sync` (design Figure 1).

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL load the `demo` control panel module only WHEN `DEMO_CONTROLS_ENABLED` is `true`, and its `DemoAccountsModule` only WHEN `DEMO_TEST_ACCOUNTS_ENABLED` is `true`, each independently of the other; a route of a module not loaded SHALL answer 404, so with both flags off every `/api/demo` route answers 404. Both variables default to `false`.
- **REQ-UBI-02**: The system SHALL answer every demo endpoint in the D-002 envelope, behind the JWT guard except the public read of REQ-EVT-05; `POST` endpoints SHALL also carry a CASL policy: `demo.stage` (TrekLink Admin) for staging, `demo.switchRole` or `demo.switchRole.org` (every seeded role) for the role switch.
- **REQ-UBI-03**: The system SHALL reach every other module's data only through that module's exported services (NFR-MNT-01).

### Event-driven

- **REQ-EVT-01**: WHEN a signed-in user reads `GET /api/demo/status`, the system SHALL return `enabled`, `databaseLocal` and the last staged scenario with its time, or null.
- **REQ-EVT-02**: WHEN an Admin reads `GET /api/demo/scenarios`, the system SHALL return the seven scenarios with `id`, `title`, `flow`, `summary`, `available` and `unavailableReason`.
- **REQ-EVT-03**: WHEN an Admin stages an available scenario, the system SHALL, in order: truncate every table of the `public` schema except `_prisma_migrations` and the migration-filled reference tables (design §3), in one transaction with `RESTART IDENTITY`; run the demo seed in-process; apply the scenario's steps; write one audit entry `demo.stage`; and return `{ scenarioId, stagedAt, records, firstSteps, session }`, where `session` is a token pair and account for the seeded Admin, so the presenter stays signed in.
- **REQ-EVT-04**: WHEN a signed-in user switches to a role, the system SHALL issue a token pair for the seeded account of that role as a sign-in would, and SHALL record an auth event `DEMO_SWITCH` for that account.

- **REQ-EVT-05**: WHEN anyone, signed in or not, reads `GET /api/demo/accounts` while `DEMO_TEST_ACCOUNTS_ENABLED` is `true`, the system SHALL return `{ accounts }`, one entry per account the demo seed creates in the order Admin, Staff, Manager, Operator, each with `role`, `roleLabel`, `email`, `password`, `fullName` and `organization` (the organization code, null for a TrekLink account), with each password read at request time from its `SEED_*_PASSWORD` variable, the same variables the seed's `readPasswords` reads, never stored and never logged, and with the header `Cache-Control: no-store`. The read SHALL answer whatever `NODE_ENV` and the database hosts are, because it is read-only, touches no database and loads no seed file (it reads a compiled copy of the seed's account list, kept equal to it by a unit test); it SHALL NOT pass the control panel checks of REQ-ERR-01 to REQ-ERR-03, and none of those checks SHALL be relaxed for the other routes. Authority: D-088 amendment of 2026-11-01 (testers sign in as any role without asking anyone for a password) and D-089 (the list also shows on the Vercel production).

### Unwanted behaviour

- **REQ-ERR-01**: IF `NODE_ENV` is `production`, THEN a stage or a role switch SHALL answer 403 `DEMO_DISABLED`.
- **REQ-ERR-02**: IF the host of `DATABASE_URL` or of `DATABASE_DIRECT_URL` is not a loopback address (`localhost`, `127.0.0.0/8`, `::1`), OR the query string of either carries a parameter that changes the connection target (`host`, `hostaddr`, `service`, `servicefile`, matched in any case and after URL decoding, because Prisma's Postgres driver connects to a `host` query parameter; review of treklink-web#245), THEN a stage or a role switch SHALL answer 403 `DEMO_DATABASE_NOT_LOCAL` with "Demo controls run only against a local database." and SHALL change nothing. A Neon host (`*.neon.tech`) is the case this protects (D-062).
- **REQ-ERR-03**: IF a stage or a role switch is running, THEN a second one SHALL answer 409 `DEMO_BUSY`.
- **REQ-ERR-04**: IF the scenario is unknown, THEN 404 `NOT_FOUND`; IF it is not available, THEN 409 `DEMO_SCENARIO_UNAVAILABLE` with its reason; both before any row is touched.
- **REQ-ERR-05**: IF a `SEED_*_PASSWORD` variable is missing, THEN a stage or the test accounts read SHALL answer 409 `DEMO_SEED_NOT_CONFIGURED` naming the variables, before any row is touched.
- **REQ-ERR-06**: IF the seeded account of the requested role does not exist or may not sign in, THEN a role switch SHALL answer 404 `NOT_FOUND` "No seeded account for this role. Stage a scenario first."

### 2.4 Field simulation (D-093 amendment, D-094, 2026-11-02)

- **REQ-SIM-01**: The system SHALL load the simulation routes only WHEN `DEMO_SIMULATION_ENABLED` is `true` (default `false`), independently of `DEMO_CONTROLS_ENABLED`; with the flag off they answer 404. While the flag is on, the field data simulator of gateway-sync design §2 reads its nodes from the simulation table instead of its two fixed nodes; with it off the fixed simulator of D-090 is unchanged.
- **REQ-SIM-02**: The system SHALL accept a simulation write only WHEN the database of `DATABASE_URL` and `DATABASE_DIRECT_URL` is on a loopback host (REQ-ERR-02) OR is named `treklink_prod` (the Vercel staging of D-094, the same check as `backend/scripts/vercel-build.sh`); otherwise 403 `DEMO_DATABASE_NOT_ALLOWED` and nothing changes. `NODE_ENV` is not checked, because the staging runs as production. The simulation never truncates, resets or deletes a row.
- **REQ-SIM-03**: WHEN an Admin starts a simulated node for a device that has a `nodeNum`, a trail from the trail list and a pattern, the system SHALL store it and, from the next simulator run, ingest one position and one telemetry packet for it per `gatewaySync.simulatorIntervalSeconds` through the node uplink path, with the packet ids derived from node, kind and interval start so a repeated run stores nothing twice (D-006).
- **REQ-SIM-04**: The patterns SHALL be: `WALK` (along the trail at the node's speed, from its start offset, turning back at the end), `STOP` (stays at its current point), `STRAY` (leaves the trail at its current point, 300 m to one side over ten minutes), `SILENT` (sends nothing, so the device turns stale after the staleness threshold), `LOW_BATTERY` (walks while the battery falls 2 points a minute to 5 %). An Admin MAY change a running node's pattern; the move starts from where the node is.
- **REQ-SIM-05**: WHEN an Admin raises `SOS` or `FALL` on a simulated node, the system SHALL ingest at once, through the node uplink path, the packets a TrekLink node sends for it on the wire (firmware ground truth §2): the text `SOS - [lat], [lon]` or `SOS - FALL DETECTED - [lat], [lon]` at the node's current position, then position beacons every 5 s for the first 60 s and every 30 s after, as far as the simulator's runs allow, until the Admin raises `SOS_CANCEL`. `SOS_CANCEL` stops the beacons and sends nothing, because the firmware sends no cancel packet; the incident is then resolved by a person as for a real device. Incidents open, route, notify and escalate as for a real device.
- **REQ-SIM-06**: The system SHALL mark every field event the simulator ingests as simulated, and SHALL show a "Simulated" label on what is derived from it and shown to a person: the device on the live maps and lists, the incident opened from it, and the panel's own rows.
- **REQ-SIM-07**: The system SHALL write one audit entry per simulation command (`demo.simulation.start`, `.update`, `.stop`, `.event`) with the device and the parameters, and SHALL answer every simulation route with the `demo.simulate` policy (TrekLink Admin).
- **REQ-SIM-08**: WHEN an Admin opens the panel, the system SHALL list the trails (`id`, name, region, length, point count, source), the patterns, the devices that can be simulated (have a `nodeNum`, with asset tag, status and organization), and the running and stopped simulated nodes with their pattern, trail, current position, battery and last packet time.

## 3. Acceptance Criteria

- **AC-01**: With `DEMO_CONTROLS_ENABLED=false`, `GET /api/demo/status` is 404.
- **AC-02**: With `DATABASE_URL` on `ep-x.ap-southeast-1.aws.neon.tech`, or `postgresql://u:p@localhost:5432/neondb?host=ep-x.neon.tech` (also `HOST=` and `%68ost=`), or the same in `DATABASE_DIRECT_URL`, a stage is 403 `DEMO_DATABASE_NOT_LOCAL` and no SQL runs.
- **AC-03**: Staging `clean`, then `contract-ready-for-handover`, then `term-ended` on a local Postgres leaves, respectively: RC-2026-0001 to RC-2026-0003 and no ORG-0002; RC-2026-0004 APPROVED with five reserved v3 units and its holding fee paid; RC-2026-0002 RETURN_DUE.
- **AC-04**: After a stage the presenter's window is signed in as the seeded Admin without a sign-in page.
- **AC-05**: With `DEMO_TEST_ACCOUNTS_ENABLED=true`, `NODE_ENV=production` and `DATABASE_URL` on `*.neon.tech`, `GET /api/demo/accounts` without a token returns four accounts whose passwords equal the four `SEED_*_PASSWORD` values, with `Cache-Control: no-store`, while a stage still answers 403 there. With both flags off every `/api/demo` route is 404. The root page and `/sign-in` then show the "Sandbox test accounts" box, or nothing.
- **AC-06**: With `DEMO_SIMULATION_ENABLED=true` on the Vercel staging (`NODE_ENV=production`, database `treklink_prod`), an Admin starts TL-0010 on a trail with `WALK`; within two simulator runs its marker moves on the organization's live map with a "Simulated" label. With `DATABASE_URL` on a Neon database not named `treklink_prod`, the start answers 403 `DEMO_DATABASE_NOT_ALLOWED`.
- **AC-07**: `SOS` on a simulated rented node opens exactly one incident, labelled Simulated, routed to the on-duty operator; a second `SOS` within the episode adds to it; after `SOS_CANCEL` no further beacon arrives and the incident stays open until a person resolves it. `SILENT` turns the device stale after the threshold; `WALK` again clears it.
- **AC-08**: A person runs AC-06 and AC-07 from the browser alone, using the panel, with no terminal, script or agent.

