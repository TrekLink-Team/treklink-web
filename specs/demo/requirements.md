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
  - Destructive staging and password-free role switching against a shared or production database; both remain refused. Additive quick controls follow section 4. The test accounts list reads no database (D-089)
  - New business rules: a scenario only calls services that already exist, or a small exported read or command added to the owning module
  - The legacy reset-based loss scenario remains unavailable; additive loss/fault reporting follows section 4
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

- **REQ-SIM-01**: The system SHALL load simulation control routes only WHEN `DEMO_SIMULATION_ENABLED` is `true` (default `false`) and the W43 control/environment gate passes; otherwise they answer 404. While the flag is on, the field data simulator of gateway-sync design §2 reads its nodes from the simulation table instead of its two fixed nodes; with it off the fixed simulator of D-090 is unchanged.
- **REQ-SIM-02**: The system SHALL accept a simulation write only WHEN the database of `DATABASE_URL` and `DATABASE_DIRECT_URL` is on a loopback host (REQ-ERR-02) OR is named `treklink_prod` (the Vercel staging of D-094, the same check as `backend/scripts/vercel-build.sh`); otherwise 403 `DEMO_DATABASE_NOT_ALLOWED` and nothing changes. `NODE_ENV` is not checked, because the staging runs as production. The simulation never truncates, resets or deletes a row.
- **REQ-SIM-03**: WHEN an Admin starts a simulated node for a device that has a `nodeNum`, a trail from the trail list and a pattern, the system SHALL store it and, from the next simulator run, ingest one position and one telemetry packet for it per `gatewaySync.simulatorIntervalSeconds` through the node uplink path, with the packet ids derived from node, kind and interval start so a repeated run stores nothing twice (D-006).
- **REQ-SIM-04**: The patterns SHALL be: `WALK` (along the trail at the node's speed, from its start offset, turning back at the end), `STOP` (stays at its current point), `STRAY` (leaves the trail at its current point, 300 m to one side over ten minutes), `SILENT` (sends nothing, so the device turns stale after the staleness threshold), `LOW_BATTERY` (walks while the battery falls 2 points a minute to 5 %). An Admin MAY change a running node's pattern; the move starts from where the node is.
- **REQ-SIM-05**: WHEN an Admin raises `SOS` or `FALL` on a simulated node, the system SHALL ingest at once, through the node uplink path, the packets a TrekLink node sends for it on the wire (firmware ground truth §2): the text `SOS - [lat], [lon]` or `SOS - FALL DETECTED - [lat], [lon]` at the node's current position, then position beacons every 5 s for the first 60 s and every 30 s after, as far as the simulator's runs allow, until the Admin raises `SOS_CANCEL`. `SOS_CANCEL` stops the beacons and sends nothing, because the firmware sends no cancel packet; the incident is then resolved by a person as for a real device. Incidents open, route, notify and escalate as for a real device.
- **REQ-SIM-06**: The system SHALL mark every field event the simulator ingests as simulated, and SHALL show a "Simulated" label on what is derived from it and shown to a person: the device on the live maps and lists, the incident opened from it, and the panel's own rows.
- **REQ-SIM-07**: The system SHALL write one audit entry per simulation command (`demo.simulation.start`, `.update`, `.stop`, `.event`) with the device and the parameters, and SHALL answer every simulation route with the `demo.simulate` policy (TrekLink Admin).
- **REQ-SIM-08**: WHEN an Admin opens the panel, the system SHALL list the trails (`id`, name, region, length, point count, source), the patterns, the movement styles (REQ-SIM-09), the devices that can be simulated (have a `nodeNum`, with asset tag, status and organization), and the running and stopped simulated nodes with their pattern, style, trail, current position, battery and last packet time.
- **REQ-SIM-09** (leader ruling 2026-11-06): Every simulated node SHALL carry a movement style that shapes how it moves while its pattern walks (`WALK`, `LOW_BATTERY`): `JOGGER`, `HIKER`, `CAMPER`, `EXPLORER`, `TRAIL_WALKER`, `WANDERER`, `GROUP_FOLLOWER` or `STRAGGLER` (design §9.1). WHEN a node starts without a style, the system SHALL assign one from its asset tag and a fixed seed, so the same device gets the same style and the same path in every run; an Admin MAY choose the style when starting a node and change it on a running node, and the move continues from where the node is. Speeds and rests SHALL be those of people on foot, positions SHALL stay within a few hundred metres of the node's trail, battery SHALL drain by the style's activity, and every packet stays marked simulated (REQ-SIM-06). A node started before the styles existed keeps the steady walk at its speed (style null).

## 3. Acceptance Criteria

- **AC-01**: With `DEMO_CONTROLS_ENABLED=false`, `GET /api/demo/status` is 404.
- **AC-02**: With `DATABASE_URL` on `ep-x.ap-southeast-1.aws.neon.tech`, or `postgresql://u:p@localhost:5432/neondb?host=ep-x.neon.tech` (also `HOST=` and `%68ost=`), or the same in `DATABASE_DIRECT_URL`, a stage is 403 `DEMO_DATABASE_NOT_LOCAL` and no SQL runs.
- **AC-03**: Staging `clean`, then `contract-ready-for-handover`, then `term-ended` on a local Postgres leaves, respectively: RC-2026-0001 to RC-2026-0003 and no ORG-0002; RC-2026-0004 APPROVED with five reserved v3 units and its holding fee paid; RC-2026-0002 RETURN_DUE.
- **AC-04**: After a stage the presenter's window is signed in as the seeded Admin without a sign-in page.
- **AC-05**: With `DEMO_TEST_ACCOUNTS_ENABLED=true`, `NODE_ENV=production` and `DATABASE_URL` on `*.neon.tech`, `GET /api/demo/accounts` without a token returns four accounts whose passwords equal the four `SEED_*_PASSWORD` values, with `Cache-Control: no-store`, while a stage still answers 403 there. With both flags off every `/api/demo` route is 404. The root page and `/sign-in` then show the "Sandbox test accounts" box, or nothing.
- **AC-06**: With `DEMO_SIMULATION_ENABLED=true` on the Vercel staging (`NODE_ENV=production`, database `treklink_prod`), an Admin starts TL-0010 on a trail with `WALK`; within two simulator runs its marker moves on the organization's live map with a "Simulated" label. With `DATABASE_URL` on a Neon database not named `treklink_prod`, the start answers 403 `DEMO_DATABASE_NOT_ALLOWED`.
- **AC-07**: `SOS` on a simulated rented node opens exactly one incident, labelled Simulated, routed to the on-duty operator; a second `SOS` within the episode adds to it; after `SOS_CANCEL` no further beacon arrives and the incident stays open until a person resolves it. `SILENT` turns the device stale after the threshold; `WALK` again clears it.
- **AC-08**: A person runs AC-06 and AC-07 from the browser alone, using the panel, with no terminal, script or agent.


## 4. Staging quick scenarios (W43, 2026-11-07)

This section supersedes the local-only scope for additive quick actions. The legacy stage and role-switch commands remain local-only, with their existing production refusal. No quick command resets, truncates, seeds or deletes data.

- **REQ-QUICK-01**: The control module SHALL load only when `DEMO_CONTROLS_ENABLED=true` and the explicit `VITE_APP_ENV` is `sandbox` or `staging`. Every quick read and write SHALL require a TrekLink Admin role and `demo.stage`. Every write SHALL additionally require both database URLs to pass the existing simulation database check. Real production, including the AWS field host, SHALL have no control routes.
- **REQ-QUICK-02**: WHEN an Admin creates a quick organization, the system SHALL call the onboarding service with a fresh counter in its Demo legal name, tax code and fictitious contact email, returning its pending application link.
- **REQ-QUICK-03**: WHEN an Admin chooses an Active organization, active variant, quantity and target `REQUESTED`, `APPROVED`, `ACTIVE` or `RETURN_DUE`, the system SHALL use the real request, approval, invoice, counter payment, provisioning and handover services as needed. Quantity SHALL default to `rentals.minOrderQuantity`. ACTIVE SHALL contain multiple units. Stock, payment, provisioning, organization and signature guards SHALL apply. The panel SHALL disclose the synthetic demo signature and manual provisioning, neither represents physical work. RETURN_DUE SHALL additionally give notice, shift only this contract's term end and execute its real rollover.
- **REQ-QUICK-04**: WHEN an Admin chooses a rented unit for a quick incident, the system SHALL reject an already open incident or ingest a fresh SOS through the existing normal uplink path, marked simulated, and return the resulting incident link. Alerts and escalation SHALL run normally.
- **REQ-QUICK-05**: WHEN an Admin chooses a rented unit for loss or fault, the system SHALL call the real loss or fault report service and return the case or contract link. Existing state and custody checks SHALL apply.
- **REQ-QUICK-06**: WHEN an Admin refreshes walkers, the simulator SHALL start or refresh rented nodes as WALK and reset its own battery anchors to plausible values. The panel SHALL label WF-02 Simulated.
- **REQ-QUICK-07**: WHEN an Admin enables the escalation demo profile, the system SHALL atomically save the current four parameter values and set primary, backup and manager acknowledgment timeouts to 30 seconds and reopen window to 5 minutes through ParameterService. Disable SHALL restore the saved values atomically. The snapshot and optimistic version SHALL survive restarts. A parameter changed meanwhile SHALL cause STALE_VERSION rather than be overwritten. The panel SHALL show current profile and version.
- **REQ-QUICK-08**: WHEN an Admin advances a contract, the system SHALL accept its expectedVersion, give notice if needed and shift only its term end to the existing business cutoff, then run its rollover. WHEN an Admin advances an incident, the system SHALL accept expectedVersion, move its deadline to now and apply its next normal tier transition, preserving normal routing and alerts. These actions SHALL be labelled Demo time controls.
- **REQ-QUICK-09**: Every quick command SHALL allocate a durable counter, retain its actor and result links as demo provenance, and audit the actual requesting Admin after committed work. Failures after a committed business step SHALL retain links to partial records, name the cause and permit inspection without resetting anything. Every business identifier SHALL use the owning module's allocator. New entities without a demo flag SHALL be identifiable from Demo names or the persistent scenario registry; simulated events SHALL retain their existing flag.
- **AC-QUICK-01**: Disabled flag, missing/wrong application environment, real production or forbidden database SHALL perform no business writes. Non-Admin callers SHALL receive 403. Staging production SHALL permit additive controls while role switching and resets remain forbidden.
- **AC-QUICK-02**: Repeated quick actions SHALL yield distinct identifiers without deleting earlier records; real-service invoices, incidents, alerts and audit actor SHALL be observable in Postgres integration tests.

W43 also supersedes REQ-SIM-01's independent route loading: DemoSimulationModule requires DEMO_CONTROLS_ENABLED, explicit VITE_APP_ENV sandbox/staging and DEMO_SIMULATION_ENABLED together. The existing field simulator job retains its independent job flag. The page and navigation require control status, never a simulation response alone.

Simulation control writes also enforce live ADMIN role plus the demo.simulate CASL policy, with the verified caller passed into the database/role guard. An organization-scoped caller is refused.

## W43b review corrections (2026-11-07)

- **REQ-QUICK-10**: The backend SHALL leave VITE_APP_ENV without a default, so validated configuration cannot enable controls when the caller omitted the variable. A whole AppModule production boot with both demo flags enabled and VITE_APP_ENV unset SHALL omit status, quick and simulation routes (404).
- **REQ-QUICK-11**: A failed quick action SHALL retain its audit/provenance and partial links, then answer isSuccess false with the owning HTTP status and error code. The error result SHALL include runId, label and records when a run was allocated. The panel SHALL show those links and disclose that the requesting/reporting account for quick contracts and fault reports is the signed-in Admin.

## 5. Demo panel for a defence (added 2026-11-24, D-110)

Authority: D-110 (leader, 2026-11-19), TK-243. Rule 6 of D-110 makes this section the one exception to the
D-103 spec freeze: demo tooling only, no product scope. Every clause below is marked "(added 2026-11-24,
D-110)". Where a clause of this section and an earlier section of this file disagree, this section governs
the panel routes of api-design 13 to 16 only; the earlier routes keep their rules.

**Roles in a defence** (added 2026-11-24, D-110): the **presenter** talks and reads the script; the **site
clicker** drives the real screens with the seeded accounts; the **panel operator** runs scenarios, quick
actions, playback and the reseed from `/demo/panel`. None of them signs in to the panel with an account.

### Ubiquitous

- **REQ-PNL-01** (added 2026-11-24, D-110): The system SHALL load the panel routes of api-design 13 to 16
  only WHEN `DEMO_PANEL_PASSWORD_HASH` holds a hash of the form `scrypt:<salt hex>:<hash hex>`; otherwise
  every panel route SHALL answer 404. The variable has no default. `DEMO_CONTROLS_ENABLED`, `VITE_APP_ENV`
  and `NODE_ENV` SHALL NOT load or unload the panel.
- **REQ-PNL-02** (added 2026-11-24, D-110): The panel routes SHALL need no account: no JWT and no CASL
  policy. Every panel route, reads included, SHALL require the panel password in the request header
  `X-Demo-Panel-Password`, compared in constant time against `DEMO_PANEL_PASSWORD_HASH`. The password and
  the hash SHALL never be logged, returned or stored by the system. Admin accounts play no part in the
  panel. This replaces, for these four routes only, the JWT and policy rule of REQ-UBI-02.
- **REQ-PNL-03** (added 2026-11-24, D-110): Every panel action SHALL run through the exported service of
  the owning module, under the same rules as the real screens (state machine, optimistic `version`,
  membership, stock, payment and custody checks), acting as the account whose real screen the step stands
  for: Staff for approvals, the counter and payments; the Admin for organization approval; a live member of
  the record's organization (Operator first, then Manager) for incident owner actions and requests.
- **REQ-PNL-04** (added 2026-11-24, D-110): The system SHALL write one audit entry per panel command, with
  `actorId` null, `actorRoles` `['DEMO_PANEL']`, action `demo.panel.<command>`, the account the command
  acted as, the result links and the client address, in addition to the audit entries the owning
  services write.
- **REQ-PNL-05** (added 2026-11-24, D-110): The panel SHALL answer in the D-002 envelope.

### Event-driven

- **REQ-PNL-06** (added 2026-11-24, D-110): WHEN the panel operator reads `GET /api/demo/panel` with the
  right password, the system SHALL return the action catalogue, the options the actions need (open
  incidents, contracts by state, unpaid invoices, devices by state, active organizations and variants),
  the playback state and whether a reseed is possible now with the reason when it is not. A right
  password read is how the page checks the typed password.
- **REQ-PNL-07** (added 2026-11-24, D-110): WHEN the panel operator runs an action, the system SHALL
  perform it and return `{ action, runId, label, actedAs, records }`, where `records` link to the real
  screens. The actions SHALL be:
  - incidents: `incident-sos` (a simulated SOS from a rented unit through the node uplink path, as
    REQ-QUICK-04), `incident-acknowledge`, `incident-respond`, `incident-resolve`,
    `incident-false-alarm` (as Staff when the incident is `UNROUTED`, as REQ-PNL-03 otherwise) and
    `incident-close` (a disclosed demo time control: the reopen window of a `RESOLVED` or `FALSE_ALARM`
    incident ends now and the normal close applies);
  - contracts: `contract-create` (a monthly request, by default ORG-0001, `treklink-v3` and
    `rentals.minOrderQuantity` units), `contract-approve`, `contract-handover` (holding fee paid at the
    counter if due, every unit provisioned, a synthetic signature, disclosed as in REQ-QUICK-03),
    `contract-return` (notice and end now when the contract runs, then check-in, reset and a passed
    inspection of every unit), `contract-close` (every open balance paid at the counter, then close) and
    `contract-cancel` (a stale request removed through the real cancel);
  - billing: `invoice-pay` (a counter payment of what is due);
  - devices: `device-maintenance-open` and `device-maintenance-complete`.
- **REQ-PNL-08** (added 2026-11-24, D-110): WHEN the panel operator starts playback of a main flow
  (`MF-01a`, `MF-01b`, `MF-01c`, `MF-02`, `MF-03`, `MF-04`, `MF-05`), the system SHALL run the flow's steps
  of `docs/demo/2026-11-22-scenario-playbook.md` in order, one step every `intervalSeconds` (3 to 60,
  default 10), each through the actions of REQ-PNL-07 or, for a step that only shows a screen, as a
  narration line with no write. The operator SHALL be able to pause, resume, run the next step at once
  and stop. One playback runs at a time. A failed step SHALL stop the playback with the step, its error
  and its committed links. `MF-02` ingests one simulated position packet per rented unit of ORG-0001 with
  a node number through the node uplink path.
- **REQ-PNL-09** (added 2026-11-24, D-110): WHEN the panel operator requests a reseed with the typed
  confirmation `RESET DEMO DATA`, the system SHALL, in order: run every check of REQ-PNL-12; delete the
  rows of every table of the connection's schema except `_prisma_migrations` and the migration-filled
  reference tables (design §3); load the standard demo seed; write one audit entry `demo.panel.reset`
  after the seed, so the entry is kept after the wipe; and return `{ resetAt, tables, seedGroups }`.
  The reseed SHALL change no schema object: no migration, no `ALTER`, no `DROP`, no `CREATE`.

### Unwanted behaviour

- **REQ-PNL-10** (added 2026-11-24, D-110): IF the header `X-Demo-Panel-Password` is missing or wrong,
  THEN every panel route SHALL answer 401 `DEMO_PANEL_PASSWORD_INVALID` "Enter the panel password." and
  change nothing.
- **REQ-PNL-11** (added 2026-11-24, D-110): IF one client address sends 5 wrong or missing passwords
  within 10 minutes, THEN every panel route SHALL answer that address 429 `RATE_LIMITED` until the
  10 minutes from its first failure have passed, without comparing a password. A right password does not
  clear the count.
- **REQ-PNL-12** (added 2026-11-24, D-110): IF any of these holds, THEN a reseed SHALL answer as listed
  and change nothing, checked in this order:
  `DEMO_RESET_ENABLED` is not `true` (403 `DEMO_DISABLED`); `DEMO_DATABASE_HOST` is empty, or the host of
  `DATABASE_URL` is not exactly `DEMO_DATABASE_HOST`, or the host of `DATABASE_DIRECT_URL` is not the same
  database endpoint, or either query string carries `host`, `hostaddr`, `service`, `servicefile`, `dbname`
  or `database` (403 `DEMO_DATABASE_NOT_ALLOWED`); the confirmation is not exactly `RESET DEMO DATA` (400
  `VALIDATION_FAILED`); a reseed started in this process, or a `demo.panel.reset` audit entry was
  written, less than 5 minutes ago (429 `RATE_LIMITED` naming the time it opens again); another reseed or
  playback is running (409 `DEMO_BUSY`); a `SEED_*_PASSWORD` variable is missing or the demo seed is not
  in this build (409 `DEMO_SEED_NOT_CONFIGURED`).
- **REQ-PNL-13** (added 2026-11-24, D-110): IF a panel write runs on a database that is neither allowed
  for the simulation (REQ-SIM-02) nor the `DEMO_DATABASE_HOST` endpoint, THEN it SHALL answer 403
  `DEMO_DATABASE_NOT_ALLOWED` and change nothing.
- **REQ-PNL-14** (added 2026-11-24, D-110): IF an action names an unknown action, record or state, THEN
  the owning service's error SHALL be returned in the D-002 envelope, with the run's committed links in
  `result.records` as REQ-QUICK-11 does.

### Acceptance

- **AC-PNL-01** (added 2026-11-24, D-110): With `DEMO_PANEL_PASSWORD_HASH` unset, every route of
  api-design 13 to 16 answers 404. With it set, each of them answers 401 without the header and with a
  wrong password, and a unit test enumerates the panel controller's routes so a new route without the
  guard fails it.
- **AC-PNL-02** (added 2026-11-24, D-110): The sixth wrong password from one address within 10 minutes
  answers 429, and the right password from that address also answers 429 until the window ends.
- **AC-PNL-03** (added 2026-11-24, D-110): A reseed is refused, with nothing deleted, for each refusal of
  REQ-PNL-12; on the demo branch with every check passing it leaves RC-2026-0001 to RC-2026-0003 and one
  `demo.panel.reset` audit entry.
- **AC-PNL-04** (added 2026-11-24, D-110): The panel operator plays MF-03 on a seeded database: an SOS from
  TL-0010 opens an incident the site clicker sees as the Operator; pause holds the next step; resume
  acknowledges, responds and resolves it.
