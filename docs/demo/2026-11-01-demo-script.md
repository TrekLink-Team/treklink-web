# Demo script, supervisor meeting 2026-11-01 (MF-01 to MF-05)

Prepared 2026-10-30 by KhoaDD under D-078, from `dev` at `cdaecf1`; refreshed on `dev` at `ca7711c`
(#128 plans page, #135 organization lifecycle, #147 sync status page, #149 DEFAULTED contract seed,
#150 incidents figures), with every changed step cited again. Every step names the source it
was traced to, as `file:line`. A step marked **(unverified)** could not be traced to code or to a
handoff that ran it.

> [!IMPORTANT]
> **Nothing in this script was clicked through in a browser for this document.** Each step is traced
> to the page code, the demo seed and the 2026-10-30 handoffs; the handoffs that ran their steps say
> so ("verified over HTTP"). Rehearse the whole script once on Saturday against a fresh seed, on the
> laptop and browser used on Sunday, and correct this file where the screen differs.

The five main flows, as `specs/README.md:25-31` maps them to modules:

| Flow | What it shows | Modules |
|---|---|---|
| MF-01 | Request a contract to counter handover, then the Field Station credential | rentals, billing, devices, organizations |
| MF-02 | Device data reaching the platform through the Field Station bridge, and its sync status | gateway-sync, `gateway/` |
| MF-03 | SOS to incident: alert, acknowledge, resolve; Staff authority reports on an incident and a defaulted contract | incidents |
| MF-04 | Live map for the organization and the fleet | monitoring |
| MF-05 | Term end to close: notice, return, inspection, closing invoice, close | rentals, billing, devices |

---

## 1. Setup

### 1.1 Environment variables (names only, values from the team's private channel)

Repository root `.env` (read by the backend, the seed and the gateway: `backend/prisma/seed-demo.ts:1052`,
`gateway/src/config.ts:18`; template `.env.example`):

| Variable | Why the demo needs it | Source |
|---|---|---|
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | Local Docker Postgres, **not Neon**, so a reset is safe | `backend/src/modules/platform/config/environment-variables.ts:62-69` |
| `MQTT_BROKER_URL` | The local Mosquitto from `docker-compose.yml` | `environment-variables.ts:71-74`, `docker-compose.yml:20-31` |
| `JWT_ACCESS_SECRET` | Sign-in | `environment-variables.ts:117` |
| `CORS_ORIGINS` | The frontend origin | `environment-variables.ts:152` (default) |
| `MAIL_TRANSPORT` | Leave `console`: mail goes to the backend log (see Disclosures) | `environment-variables.ts:138-139` |
| `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`, `SEED_MANAGER_PASSWORD`, `SEED_OPERATOR_PASSWORD` | The four demo accounts; at least `auth.passwordMinLength` long | `seed-demo.ts:30-31, 237-243, 1041-1048` |
| `SEED_ORG_API_KEY` (optional) | One organization API key for ORG-0001, for the MF-04 API step | `seed-demo.ts:32-33, 990-1008` |
| `GATEWAY_SERIAL_SIMULATION` | Keep `true`: no radio on the USB port | `gateway/src/config.ts:88` |
| `GATEWAY_FS_USERNAME` | Set `fs-org-0001-1`, the seeded Field Station, so the gateway's health report lands on the MF-02 sync status page; empty sends no report | `gateway/src/config.ts:73-83`, `gateway/src/mqtt/mqtt-client.ts:106-125`, `.env.example:113-118` |
| `GATEWAY_HEALTH_INTERVAL_MS` | Keep `60000`; the gateway also reports after each flush that empties the queue | `gateway/src/config.ts:82`, `gateway/src/mqtt/mqtt-client.ts:66` |
| `GATEWAY_SIM_NODES` | Keep the default `!de000009,!de00000a` (TL-0009, TL-0010) | `gateway/src/config.ts:93-94` |
| `GATEWAY_SIM_SOS_EVERY` | **Set `0` for the demo.** The default `12` sends an SOS from TL-0009 every 12 ticks (60 s at the default interval) and would open MF-03 in the middle of MF-01 | `gateway/src/config.ts:100-101`, `gateway/src/serial/simulator.ts:33-36` |
| `FIELD_STATION_RELEASE_DIR` (optional) | Without it the Field Station software card shows an error (503 `RELEASE_UNAVAILABLE`); the table still works | `environment-variables.ts:101-104`, `backend/src/modules/organizations/field-station-release.service.ts:72-74` |
| `SEPAY_WEBHOOK_API_KEY` | Unset is fine: the demo pays at the counter (see Disclosures) | `environment-variables.ts:196-209` |
| `VITE_API_BASE_URL`, `VITE_WS_URL` | The frontend's API and live socket | `.env.example` |

### 1.2 Commands, Saturday evening and again Sunday before the meeting

Run from the repository root.

```bash
docker compose up -d
```

```bash
npm --prefix backend run prisma:deploy
```

```bash
npm --prefix backend run seed:demo
```

The seed prints one `created ...` line per row group and `Demo seed: N row group(s) created.`
(`seed-demo.ts:1060-1061`). A second run prints `0 row group(s)`; it never updates a row, so a changed
`SEED_*_PASSWORD` applies only to a fresh database (`seed-demo.ts:20-23`).

```bash
npm run dev
```

This starts the backend, the gateway (simulation mode) and the frontend together, prefixed
`[backend]`, `[gateway]`, `[frontend]` (`scripts/dev.mjs:1-11`). Swagger is at
`http://localhost:3000/api/docs` (`backend/src/main.ts:29-34`).

### 1.3 What the seed gives you

| Record | State after the seed | Used in | Source |
|---|---|---|---|
| ORG-0001, TrekLink Demo Tours Co., Ltd. | ACTIVE; Manager and Operator are members | all | `seed-demo.ts:271-316` |
| Roster shift | Operator primary, Manager backup, from a day before the seed for a year | MF-03 | `seed-demo.ts:318-334` |
| treklink-v2, v3, v4 | 400,000, 450,000 and 480,000 VND a month | MF-01 | `seed-demo.ts:142-164` |
| Damage rates | ANTENNA_BROKEN 300,000 VND, CASING_CRACKED 400,000 VND | MF-05 | `seed-demo.ts:166-169` |
| TL-0001 to TL-0008, TL-0011 to TL-0016 | AVAILABLE; ten are treklink-v3 (TL-0003 to TL-0006, TL-0011 to TL-0016) | MF-01 | `seed-demo.ts:174-193` |
| **RC-2026-0001** | ACTIVE monthly, TL-0009 (Le Thi E) and TL-0010 (Pham Van F) RENTED, no invoice | MF-02, MF-03, MF-04 | `seed-demo.ts:83-88, 431-522` |
| **RC-2026-0002** | ACTIVE monthly, TL-0017 (Hoang Thi Mai) and TL-0018 (Vu Van Nam) RENTED, first invoice paid in full | MF-05 | `seed-demo.ts:91-108, 524-781` |
| **UNROUTED incident on TL-0001** | `INC-2026-000001` on a fresh database, opened 10 minutes before the seed ran | MF-03 step 7 | `seed-demo.ts:783-838` |
| **RC-2026-0003** | DEFAULTED monthly, one device TL-0019 (Dang Van Long) still RENTED; handed over two months ago, defaulted yesterday. ORG-0001 stays ACTIVE: the seed writes the status directly and does not suspend the organization | MF-03 step 11 | `seed-demo.ts:13-18, 97-99, 840-988` |
| **Field Station `fs-org-0001-1`** | "Ta Nang basecamp laptop" of ORG-0001, active, never reported until the gateway sends its first health report | MF-02 step 4 | `seed-demo.ts:81-82, 1011-1033` |

**RC-2026-0004 is the contract the Manager requests live in MF-01.** It is the next contract number
after the seeded RC-2026-0001 to RC-2026-0003 (`RC-<year>-<4 digits>`, one more than the highest code
of the year, `backend/src/modules/rentals/contracts.repository.ts:735-747`). A rehearsal without a
reset moves it to RC-2026-0005 and on.

**The Field Station created live in MF-01 step 13 is `fs-org-0001-2`.** The username is
`fs-<organization code in lower case>-<n>`, with `n` one more than the highest number the organization
ever used, revoked stations included (`backend/src/modules/organizations/field-stations.service.ts:147-152`,
`field-stations.repository.ts:76-85`); the seed already holds `fs-org-0001-1`. The seeded station is the
one the gateway reports as in MF-02; the new one shows how an organization gets its credential.

### 1.4 Browser windows

Sign-in lands each account on its own page (`frontend/src/entities/session/model.ts:64-73`).

| Window | Account | Lands on | Flows |
|---|---|---|---|
| A | `manager@treklink.local` (`SEED_MANAGER_PASSWORD`) | `/o`, Overview | MF-01, MF-05 |
| B | `staff@treklink.local` (`SEED_STAFF_PASSWORD`) | `/t/map`, Fleet map | MF-01, MF-02 step 4, MF-03 steps 7 to 11, MF-04, MF-05 |
| C | `operator@treklink.local` (`SEED_OPERATOR_PASSWORD`) | `/o/map`, Live map | MF-02, MF-03, MF-04 |
| D (optional) | `admin@treklink.local` (`SEED_ADMIN_PASSWORD`) | `/t/map` | Swagger parameter change for MF-03; MF-05 tail |

Plus one terminal at the repository root for `replay:mqtt` and `demo:term-end`.

> [!WARNING]
> **Do not reload a page or type a URL into the address bar.** The session is held in memory only and
> nothing is written to `localStorage` (`frontend/src/entities/session/model.ts:37-38`), so a reload
> signs that window out; sign in again and the guard returns you to the page (`router.tsx:45-58`).
> Move with the sidebar and the links. Each window, or tab, keeps its own session.

---

## 2. MF-01: request to handover (about 9 minutes)

| # | Window | Page and click | Expected on screen | Source |
|---|---|---|---|---|
| 0 (optional) | Any window before sign-in | The public plans page at `/` (also `/plans`) | "Rent TrekLink devices", the monthly and day price per variant with a "Sandbox price" badge, "How renting works", **Register your organization** and **Sign in** | `frontend/src/app/router.tsx:87-88`; `frontend/src/pages/PlansPage.tsx:44, 87-110, 191-202` |
| 1 | A Manager | Overview `/o`, **Request a contract** | The request page with three steps: Plan and devices, Start date, Review and send | `OrgDashboardPage.tsx:187-188`, `ContractRequestPage.tsx:24, 232` |
| 2 | A | Plan **Monthly**, Hardware variant **treklink-v3**, Quantity **5**, **Next** | The Quote panel shows the term fee for one month; the quantity hint reads "At least 5 devices." | `ContractRequestPage.tsx:304, 332, 351-356, 439`; `rentals.minOrderQuantity` 5 in `backend/prisma/migrations/20261004120100_seed/migration.sql:22` |
| 3 | A | Start date (handover day): **today**, **Next** | Today is the earliest date allowed | `ContractRequestPage.tsx:375-385` |
| 4 | A | Review, **Send request** | Toast "Request sent. TrekLink will confirm availability and your handover appointment."; the new contract page opens with code **RC-2026-0004**, Requested | `ContractRequestPage.tsx:28, 145-146, 448` |
| 5 | B Staff | Sidebar **Contracts** (`/t/contracts`), tab **Requested**, click **RC-2026-0004** | Side panel: plan, devices, prices; status line "10 treklink-v3 available now; approval reserves 5." | `ContractApprovalPage.tsx:41-45, 228-237, 456-476`; ten v3 units in `seed-demo.ts:185-192` |
| 6 | B | Keep the Handover appointment (today 09:00 local), **Approve** | Toast "Saved."; a green box "Reserved: TL-00xx, ..." (five tags chosen by the server) and "Reservation expires ..." | `ContractApprovalPage.tsx:46-48, 160-162, 205-213, 250-256, 278`; server picks the units, `ContractApprovalPage.tsx:303` |
| 7 | B | In the same panel **Open the contract**, then **Open the counter** | "Counter handover: RC-2026-0004" with four steps: Devices, Payment, Preview note, Sign | `ContractApprovalPage.tsx:284-285`, `ContractDetailPage.tsx:49-57, 459-463`, `CounterPage.tsx:39, 407-412` |
| 8 | B | Step 1 Devices: type a reserved tag (for example TL-0011) in **Scan or type an asset tag**, **Find**; then on each of the five rows **Record provisioning**, Battery % **90**, tick **GPS fix**; **Next** | The found row is highlighted, "TL-00xx is on this contract."; each row reads "Provisioned v1" | `CounterPage.tsx:212-220, 466-490, 520-575`; checks in `CounterPage.tsx:243-268`; minimum battery 50 % in `migration.sql:16` |
| 9 | B | Step 2 Payment: **Record a counter payment**, Method **Cash**, Amount received **1125000**, a receipt number, **Record** | "The first payment is recorded." The first line is the holding fee: 5 x 450,000 VND x 0.5 = 1,125,000 VND | `CounterPage.tsx:582-640`, `CounterPaymentDialog.tsx:79-133`; first invoice issued on approval, `backend/src/modules/rentals/contract-decisions.service.ts:139, 329-362`; `billing.holdingFeeRatio` 0.5 in `migration.sql:28`, formula `backend/src/modules/billing/money.ts:24-30` |
| 10 | B | **Next**, Step 3 Preview note | The unsigned handover note renders in a frame ("Handover note preview, not signed") | `CounterPage.tsx:645-665` |
| 11 | B | **Next**, Step 4 Sign: Signing Manager **Demo Manager**, Identity document checked "CCCD, last 4 digits 1234", the Manager signs in the box, **Complete handover** | Toast "Handover complete. 5 devices issued under contract RC-2026-0004."; page "Handover of RC-2026-0004", "5 devices issued. The contract is active and the signed note is stored." | `CounterPage.tsx:300-307, 362-376, 674-745` |
| 12 | B | **Open the contract and the handover note** | Contract page, Active, Handed over today | `CounterPage.tsx:370-372`, `ContractDetailPage.tsx:267` |
| 13 | A Manager | Sidebar **Field stations** (`/o/field-stations`): the seeded "Ta Nang basecamp laptop" is already listed. **Create Field Station**, Name "Phan Dung ranger post", **Create** | Dialog "Credential for Phan Dung ranger post": Broker URL, Username **fs-org-0001-2**, Secret, each with Copy; "Copy it now; it will not be shown again." | `FieldStationsPage.tsx:150-165, 224-240, 347`; seeded station `seed-demo.ts:1011-1033`; username rule in §1.3 |
| 14 | A | **Done** | Two rows, both Active; the new one shows Last sync "No data yet"; count "2 of 5" **(unverified: the exact count wording)** | `FieldStationsPage.tsx:44-63, 231, 388`; limit 5 in `migration.sql:14` |

Say at step 13: this is MF-01's last step, the credential the organization installs on its base
laptop (`specs/frontend/tasks.md:84`). Then go straight to MF-02, where the seeded station
`fs-org-0001-1` plays that laptop.

---

## 3. MF-02: device data through the Field Station bridge (about 5 minutes)

No 2026-10-30 handoff covers MF-02; the steps below come from the gateway code, the sync status page
of #147, and the gateway-sync task notes of 2026-10-27 and 2026-10-30
(`specs/gateway-sync/tasks.md:92-95, 115`).

| # | Window | Action | Expected | Source |
|---|---|---|---|---|
| 1 | Terminal | Point at the `[gateway]` lines of `npm run dev` | The gateway runs in simulation mode for TL-0009 and TL-0010: every 5 s a position and a telemetry reading per node, walking from Ta Nang | `gateway/src/config.ts:85-105`, `gateway/src/serial/simulator.ts:33-60` |
| 2 | Talk | Explain the path: node, LoRa, base laptop reading the radio over USB, SQLite priority queue (SOS first), MQTT QoS 1 on the node's uplink topic `treklink/2/json/LongFast/!de000009`, backend ingestion with `eventId` dedup | (talking point) | `gateway/src/config.ts:33-39, 59-70`; `specs/gateway-sync/tasks.md:115` |
| 3 | C Operator | Live map `/o/map`, device list | TL-0009 (Le Thi E) and TL-0010 (Pham Van F) with a battery percentage and a recent last-seen time; markers move every few seconds | `LiveMapPage.tsx:117-137, 248-253` |
| 4 | B Staff | Sidebar **Field data sync** (`/t/admin/sync`, group Fleet) | "Field data sync": cards MQTT subscriber UP, Accepted (last 60 min), Duplicates rejected, Unknown device; the Field Stations table lists "Ta Nang basecamp laptop", TrekLink Demo Tours Co., Ltd., **Connected**, its Last sync and Last flush, Queue depth (P0 to P3) "0, 0, 0, 0"; Recent field events list TL-0009 and TL-0010 with Ingress "Node uplink" and Attribution "Attributed" | `frontend/src/app/router.tsx:130`, `frontend/src/shared/config/navigation.ts:111`, `frontend/src/pages/SyncStatusPage.tsx:15-27, 39-169`; Connected while the last report is under `monitoring.fieldStationStaleSeconds` (180 s), `backend/src/modules/gateway-sync/sync-status.service.ts:59-66`, `migration.sql:49`; organization legal name `sync-status.service.ts:100`; the simulator's packets arrive on the node topic, `backend/src/modules/gateway-sync/adapters/node-json.adapter.ts:32`. Needs `GATEWAY_FS_USERNAME=fs-org-0001-1` (§1.1) |
| 5 | B | Change Window to another value, **Refresh** | The Accepted count grows with each refresh while the gateway runs | `SyncStatusPage.tsx:44-66, 82` |
| 6 (optional) | Terminal | Outage: `docker compose stop mosquitto`, wait about 20 s, `docker compose start mosquitto`, then **Refresh** on the sync page | The gateway queues while the broker is down and flushes on reconnect, SOS before positions; a drained queue sends a health report at once, so Last flush moves to the reconnect time; the map catches up | `specs/gateway-sync/tasks.md:115` ("2 SOS, 12 positions and 12 telemetry readings queued with the broker down, flushed SOS first"); `gateway/src/mqtt/mqtt-client.ts:62-66` **(unverified on screen: the map and the sync page after the flush were not watched)** |

If the gateway does not start, publish the recorded trek instead (12 positions of TL-0009):

```bash
npm --prefix backend run replay:mqtt -- trek --now --new-ids --interval 2000
```

(`backend/test/harness/replay.ts:1-12`; `backend/test/fixtures/mqtt/trek.json` is TL-0009, node
`!de000009`.)

---

## 4. MF-03: SOS to incident (about 9 minutes)

Before the meeting (optional, to show escalation): as Admin in Swagger (`/api/docs`), sign in with
`POST /api/auth/login`, authorize, then `PATCH /api/parameters/{key}` with `{ "value": 30,
"expectedVersion": <current>, "reason": "demo" }` for `incidents.primaryAckTimeoutSeconds`,
`incidents.backupAckTimeoutSeconds` and `incidents.managerAckTimeoutSeconds` (minimum 30), and
`incidents.reopenWindowMinutes` to `5` (minimum 5). The Parameters page is not built.
Sources: `backend/src/modules/platform/parameters/parameters.controller.ts:26-38`,
`parameter-update.dto.ts`, defaults and bounds `migration.sql:41-45`,
`docs/sessions/2026-10-30-0903-escalation-timers.md:52-58`. Read `expectedVersion` from
`GET /api/parameters` first **(unverified: the list response shape was not read)**. With the defaults
(120 s per tier) the happy path below still works; only escalation is slower.

| # | Window | Action | Expected | Source |
|---|---|---|---|---|
| 1 | Terminal | `npm --prefix backend run replay:mqtt -- sos --now --new-ids` | One SOS packet from TL-0010 (`!de00000a`), RC-2026-0001 | `backend/test/fixtures/mqtt/sos.json`; replay `backend/test/harness/replay.ts:1-12` |
| 2 | C Operator | Any page | Red banner on every page: "SOS: TL-0010 (Pham Van F), hh:mm. Acknowledge now." with **Acknowledge** | `frontend/src/app/AlertBanner.tsx:20-31, 38-60, 132`; holder label `seed-demo.ts:85-88`; routed to the Operator as primary, `seed-demo.ts:318-319` |
| 3 | C | Sidebar **Incidents** (`/o/incidents`), click the new code | Incident page: Device TL-0010, Holder Pham Van F, Owner Unclaimed, state Notifying primary, last known coordinates | `IncidentsPage.tsx:35, 102-122`; `IncidentDetailPage.tsx:234-262`; label `shared/ui/status.ts:168` |
| 4 | C | **Acknowledge** | Toast "Saved."; Owner Demo Operator, state Acknowledged; the banner clears | `IncidentDetailPage.tsx:156-162, 178-186, 207-221`; `AlertBanner.tsx:61-63` |
| 5 | C | **Response under way**, What is being done "Ranger team dispatched from the Ta Nang post", **Save response**; then **Add status**, a line, **Save status** | State Responding; the status update appears with the author and time | `IncidentDetailPage.tsx:51-57, 310-325` |
| 6 | C | **Report outcome**, Outcome "Hiker found, minor ankle injury, walked out", **Resolve incident** | State Resolved; History shows each step with the actor | `IncidentDetailPage.tsx:58-62`; History panel `docs/sessions/2026-10-30-0710-hoangtk-tk145-incident-history-panels.md:31-35` |
| 7 | B Staff | Sidebar **Incidents** (`/t/incidents`), filter **Unrouted and escalated**, click the seeded incident on **TL-0001** | Inline detail: Device TL-0001, Holder "No holder label", Owner "TrekLink Staff queue", state Unrouted | `StaffIncidentsPage.tsx:25-31, 52-70`; seed `seed-demo.ts:783-838` |
| 8 | B | **Report to authorities**, fill Agency "Lam Dong Provincial Police", Authority reference "LD-2026-1101", Reported at (now, not in the future), **Record report** | Badge "Reported to authority" | `StaffIncidentsPage.tsx:86`; `AuthorityReports.tsx:305, 317-389`; `status.ts:174`; `docs/sessions/2026-10-30-0904-incident-authority-reports.md:137-145` |
| 9 | B | Tab **Authority reports**, **Record case closed** on the row, Closed at after the report time and not in the future, confirm | Toast; with **Open cases only** ticked the row leaves the list | `AuthorityReports.tsx:468-481, 556, 638`; handoff `2026-10-30-0904-incident-authority-reports.md:143-145` |
| 10 | B | **View incident** | The TL-0001 incident is Closed | `AuthorityReports.tsx:607`; handoff `2026-10-30-0904-incident-authority-reports.md:145` |
| 11 | B | Back on **Incidents**, tab **Authority reports**, **Record report**; Subject kind **Defaulted contract** | "Only defaulted contracts can be reported."; one eligible record, **RC-2026-0003, TrekLink Demo Tours Co., Ltd.**, state Defaulted | `AuthorityReports.tsx:78-123, 549-551`; DEFAULTED contracts listed by `frontend/src/entities/incident/authorityReports.ts:64-67`; label `status.ts:95`; seed `seed-demo.ts:840-988` |
| 12 | B | Click **RC-2026-0003**; Agency "Lam Dong Provincial Police", Authority reference "LD-2026-1102", Reported at now, Note "Device TL-0019 not returned after default", **Record report** | Toast "Saved."; a row "Contract report" with **View contract** in the Authority reports list | `AuthorityReports.tsx:37, 132-143, 257, 305, 599-612` |
| 13 | B | **View contract** | `/t/contracts/<id>` of RC-2026-0003, still Defaulted: a report never changes the contract | `AuthorityReports.tsx:610-611`; `backend/src/modules/incidents/authority-reports.service.ts:151-170`; handoff `2026-10-30-0904-incident-authority-reports.md:60-63` |

Talking points while it runs: with no acknowledgement the incident walks primary, backup, manager and
then Escalated, which alerts every active TrekLink Staff and Admin account
(`docs/sessions/2026-10-30-0903-escalation-timers.md:29-36, 63-65`). A resolved incident closes
itself when `incidents.reopenWindowMinutes` ends (same file, line 33). TrekLink Staff never
acknowledge for an organization; their banner opens the queue (`AlertBanner.tsx:38-40`). If the
supervisor asks for the design, incidents design Figures 4 to 10 were redrawn from the code in #150
(`specs/incidents/design.md:251-252, 374, 605`).

---

## 5. MF-04: live map and the organization API (about 4 minutes)

No 2026-10-30 handoff covers MF-04; the steps come from the page code. The gateway keeps running
from MF-02.

| # | Window | Action | Expected | Source |
|---|---|---|---|---|
| 1 | C Operator | Sidebar **Live map** (`/o/map`) | Header "Live map", "N devices, 0 SOS open, 0 stale"; the devices in custody: RC-2026-0001's TL-0009 and TL-0010, RC-2026-0002's TL-0017 and TL-0018 until MF-05 returns them, RC-2026-0003's TL-0019 (DEFAULTED keeps its device visible) and, after MF-01, RC-2026-0004's five units; those without a report show "No position yet" | `LiveMapPage.tsx:212, 248-253`; "No position yet" `LiveMapPage.tsx:62`; custody rule `backend/src/modules/rentals/contracts.service.ts:244-250` |
| 2 | C | Type "TL-0010" in **Search asset tag, holder or contract** | One row: TL-0010, Pham Van F, battery | `LiveMapPage.tsx:257-266, 117-137` |
| 3 | C | Point at the Vietnamese sovereignty overlay and the attribution on the map | Hoang Sa and Truong Sa labels drawn over the OpenStreetMap tiles (D-031) | `frontend/src/shared/config/map.ts`, `widgets/LiveMapWidget/LiveMapWidget.tsx` **(unverified: overlay rendering not checked for this document)** |
| 4 | B Staff | Sidebar **Fleet map** (`/t/map`), Organization filter **All organizations**, then ORG-0001 | "Fleet map", every organization's devices; the filter narrows to ORG-0001 | `LiveMapPage.tsx:90-104, 212, 252-253` |
| 5 (optional) | Terminal | `curl -s -H "X-Api-Key: $SEED_ORG_API_KEY" http://localhost:3000/api/telemetry/devices` | ORG-0001's devices as JSON in the `{ result, isSuccess, statusCode, message }` envelope, for the organization's own systems | `backend/src/modules/monitoring/org-api.controller.ts:28, 44-51`; key `seed-demo.ts:990-1008` **(unverified: response body not read)** |

Talking point: a device that sends nothing for `monitoring.deviceStaleSeconds` (300 s) shows a
Stale badge (`migration.sql:48`, `LiveMapPage.tsx:129`).

---

## 6. MF-05: term end to close on RC-2026-0002 (about 9 minutes)

Steps 1 to 6 follow `docs/sessions/2026-10-30-0903-devices-retire-dispose.md:71-88`, which verified
them over HTTP with the labels taken from the code. RC-2026-0002 is used, not RC-2026-0001, because
the MF-03 SOS sits on RC-2026-0001's TL-0010 and a contract with an open incident cannot close
(409 `OPEN_INCIDENTS`, `backend/src/modules/rentals/return.service.ts:235, 275`; `seed-demo.ts:524-528`).

| # | Window | Action | Expected | Source |
|---|---|---|---|---|
| 1 | A Manager | Sidebar **Contracts** (`/o/contracts`), **RC-2026-0002**, **Give notice**, confirm **Give notice** | "Notice given" with the time on the contract page | `ContractDetailPage.tsx:286-288, 449-453`; `NoticeDialog.tsx:52, 83` |
| 2 | Terminal | `npm --prefix backend run demo:term-end -- RC-2026-0002` | Prints "Term 1 now ends ..." and "Term rollover: 0 renewed, 1 to RETURN_DUE, 0 to RETURNED." | `backend/prisma/demo-term-end.ts:83-112`; notice first or the term renews, `demo-term-end.ts:13-14, 71-75` |
| 3 | B Staff | **Contracts**, tab **All**, RC-2026-0002, **Open the contract**, **Open the counter** | "Counter: RC-2026-0002", tabs Check-in, Reset and inspection, Close | `CounterPage.tsx:378-399`; `ReturnCounter.tsx:400-412` |
| 4 | B | Check-in: type **TL-0017**, **Add**, type **TL-0018**, **Add**, **Check in 2 devices** | The scanned list empties and the Reset and inspection tab counts 2 | `ReturnCounter.tsx:326-342, 405-412, 433-460` |
| 5 | B | Reset and inspection: on each row **Record reset**, tick Channel key removed, Node database cleared, Owner name cleared, **Record reset**; then **Inspect** TL-0017, **Passed**, **Record inspection** | TL-0017 "Passed, available" | `ReturnCounter.tsx:49-51, 87-111, 173-197, 495-499` |
| 6 | B | **Inspect** TL-0018, **Damaged**, tick "Casing cracked (CASING_CRACKED)" 400,000 VND, **Record inspection** | TL-0018 "Damaged, maintenance"; the 400,000 VND charge goes on the closing invoice | `ReturnCounter.tsx:200-245`; rate `seed-demo.ts:166-169`; handoff `2026-10-30-0903-devices-retire-dispose.md:80-82` |
| 7 | B | Tab **Close**: Due now 400,000 VND; **Open the invoices**, open the closing invoice, **Record counter payment**, Cash, 400000, a receipt number, **Record** | Paid 400,000 VND, Still due 0 | `ReturnCounter.tsx:510-543`; `InvoiceDetailView.tsx:103-125`; `CounterPaymentDialog.tsx:79-133` |
| 8 | B | **Contracts**, tab **All**, RC-2026-0002, **Open the contract**, **Open the counter**, tab **Close**, **Close contract**, confirm **Close contract** | "This contract is closed." | `ReturnCounter.tsx:527-536, 586`; handoff `2026-10-30-0903-devices-retire-dispose.md:83-84` |
| 9 (optional) | B | Sidebar **Devices** (`/t/fleet`), chip **Maintenance**, **TL-0018**, its open maintenance line; on `/t/maintenance` **Complete** with actual cost 0, **Save**; **Open TL-0018**, **Record intake check**, all passed | TL-0018 back to Available | `docs/sessions/2026-10-30-0922-fleet-maintenance-pages.md:109-119`; threshold 1,000,000 VND `migration.sql:20` |
| 10 (optional) | B then D Admin | `/t/maintenance`, **Open maintenance** on spare **TL-0008**, **Complete** as Unrepairable; as Admin `/t/devices/<TL-0008>`, **Retire** with a reason, then **Dispose** (tick the three wipe steps, a method) | TL-0008 Retired, then Disposed | `docs/sessions/2026-10-30-0903-devices-retire-dispose.md:85-88`. The handoff used TL-0011; use **TL-0008** (treklink-v4) because the MF-01 approval may have reserved TL-0011, a v3 unit |

Step 3: the approval queue's default tab is Requested; RC-2026-0002 is under **All**
(`ContractApprovalPage.tsx:41-45`). The Return due date shows in the counter header
(`CounterPage.tsx:396`).

---

## 7. Disclosures: what is simulated or not built

Say these before anyone asks. Each is a one-line answer.

| Item | State in the code | What the presenter says |
|---|---|---|
| Physical serial reader | The gateway runs in simulation mode; the `FromRadio` decoder for a radio on USB is open (gateway-sync 5.1) | "Today the Field Station bridge simulates two nodes on the seed's node numbers. The queue, the priority order and the MQTT path are the real code; reading a real radio over USB is the remaining part of task 5.1." (`gateway/src/config.ts:85-89`, `specs/gateway-sync/tasks.md:111-115`) |
| Field Station credential at the broker | Issued and stored as a bcrypt hash; the local Mosquitto runs without authentication and no caller checks the credential yet. The gateway names its station only in the health report topic (`GATEWAY_FS_USERNAME`); the seeded station's secret is random and discarded | "The credential is issued and shown once. The broker-side check of it is gateway-sync 3.1; this demo broker is open." (`field-stations.service.ts:82-86, 220-227`, `docker-compose.yml:30-31`, `seed-demo.ts:1011-1015`) |
| Field Station event topic | The gateway still publishes device packets on each node's own uplink topic (Stage B); only its health report uses the station topic, so Recent field events show Ingress "Node uplink" | "Packets travel on the node topic today; the station's own event topic arrives with the station adapter." (`specs/gateway-sync/tasks.md:115`, `SyncStatusPage.tsx:160`) |
| Organization suspend, reactivate and close (#135) | Served by the backend (`POST /api/organizations/:id/suspend`, `reactivate`, `close`, with CASL policies); no button in this release, the compliance case page only hints "Ask a TrekLink Admin to suspend the organization." **Do not suspend ORG-0001 during the demo**: a request from a non-ACTIVE organization is refused | "Suspension and closure are in the API with their policies; their screen follows." (`backend/src/modules/organizations/organization-status.controller.ts:23-49`, `frontend/src/pages/ComplianceCasePage.tsx:42`, `backend/src/modules/rentals/contracts.service.ts:99`) |
| Plans page prices | The public plans page marks every price "Sandbox price" | "Prices on the public page are the demo price list, configurable by an Admin." (`PlansPage.tsx:44`, `frontend/src/app/router.tsx:87-88`) |
| Email delivery | `MAIL_TRANSPORT` is `console`: every outbound email is written to the backend log, nothing is sent | "Emails are generated and logged; with an SMTP_URL they are sent. Here is the log line." Show the `[backend]` line. (`environment-variables.ts:136-149`) |
| SePay payment | **Pay with SePay** creates a sandbox payment and shows a VietQR page marked SANDBOX; confirmation needs the SePay webhook with `SEPAY_WEBHOOK_API_KEY` | "Online payment runs against the SePay sandbox; for the demo the first payment is taken at the counter, which is the same ledger." (`InvoiceDetailView.tsx:33, 120`, `PaymentPage.tsx:80-81`, `environment-variables.ts:196-209`) |
| Field Station offline view | The local page at `127.0.0.1:4321` is not built (gateway-sync 5.2) | "The offline page on the base laptop is planned in task 5.2; the queue it will show is already working." (`specs/gateway-sync/tasks.md:118-122`) |
| Web Serial docking | Not built; Staff type the node number when registering a device (D-080, separate chain) | "Registration takes the node number by hand today; reading it from a docked device over Web Serial is decision D-080, not built yet." (`backend/src/modules/devices/intake.service.ts:38`, `specs/devices/tasks.md:54`) |
| v2 USB console | Not found anywhere in this repository **(unverified: scope and owner unknown)** | "Configuring a v2 unit over its USB console is outside this release." Check the wording with the leader before Sunday. |
| Pages not built | Parameters, Hardware variants, System health, Reports, Accounts, Audit log, Stock-take, Loss cases (`built: false`) | "Those screens are designed and scheduled; the parameter change you saw went through the API." (`frontend/src/shared/config/navigation.ts:77, 112-114, 136, 142-149`) |
| Device data | Positions, telemetry and SOS come from fixtures and the simulator synthesized from the firmware source, on placeholder node numbers | "The packets follow the firmware's wire format; captures from real v2 to v4 units replace them in gateway-sync 1.2." (`backend/test/fixtures/mqtt/README.md`, `specs/gateway-sync/tasks.md:26-27`, `seed-demo.ts:171-173`) |

---

## 8. Recovery: when a step fails live

**First, never improvise a fix on the shared database.** Every reset below is for the local Docker
database named in `DATABASE_URL`. Check it is not Neon before running any of them.

| Failure | Do this | Source |
|---|---|---|
| A window shows the sign-in page | It was reloaded. Sign in again; the page comes back | `entities/session/model.ts:37-38`, `router.tsx:45-58` |
| "Someone else changed this. Reload to see the latest." | Click **Reload** in the message (not the browser) | `CounterPage.tsx:428-441`, `ContractApprovalPage.tsx:238-249` |
| MF-01 approval says only N available | A smaller quantity is refused (minimum 5). Fall back to a second request: ten v3 units cover two requests of five | `seed-demo.ts:185-186` |
| MF-01 handover button stays disabled | The start date is not today ("Handover is possible from ...") or step 2 is unpaid. Fall back: request again with today's date | `CounterPage.tsx:193, 423-427, 741-745` |
| MF-01 "Low battery" warning | Click **Proceed anyway**, or enter a battery of 50 or more | `CounterPage.tsx:720-733`, `migration.sql:16` |
| Field Station shows `fs-org-0001-3` or higher | A rehearsal created one; numbers are never reused. Say so; the number is the only difference | `field-stations.repository.ts:76-85` |
| MF-02 no movement on the map | Check the `[gateway]` lines; run the trek replay in §3 | `backend/test/harness/replay.ts:1-12` |
| MF-02 sync page shows the station "Never reported" | `GATEWAY_FS_USERNAME` is empty (the gateway logs "GATEWAY_FS_USERNAME is not set") or names another station. Set `fs-org-0001-1` and restart `npm run dev`. "Stale" means no report for 180 s: check Mosquitto | `gateway/src/mqtt/mqtt-client.ts:118-125`, `sync-status.service.ts:59-66` |
| MF-02 sync page shows no Field Stations | The seed predates #147; run `seed:demo` again, it adds only the missing station | `seed-demo.ts:1011-1033`, `SyncStatusPage.tsx:92-95` |
| MF-03 no banner after the SOS | Check Mosquitto is up (`docker compose ps`); open **Incidents**, the incident is listed even if the live socket missed it; or send `sos-fall` instead: `npm --prefix backend run replay:mqtt -- sos-fall --now --new-ids` (also TL-0010) | `backend/test/fixtures/mqtt/sos-fall.json`; `--new-ids` avoids dedup, `replay.ts:8-9` |
| MF-03 step 7: no UNROUTED incident on TL-0001 | A rehearsal closed it, and the seed does not recreate it while TL-0001 has any incident. Fall back: an SOS from TL-0002, a device in no custody, opens a new UNROUTED incident (command below) **(unverified: the command was not run)** | `seed-demo.ts:786-790`; `docs/sessions/2026-10-30-0904-incident-authority-reports.md:118-135` |
| MF-03 step 11: RC-2026-0003 is not in the list | The seed predates #149, or the contract is no longer DEFAULTED. Run `seed:demo` again (it creates RC-2026-0003 only when absent); a contract already reported in a rehearsal can be reported again, the service checks only the DEFAULTED status | `seed-demo.ts:840-850`, `authority-reports.service.ts:151-170` |
| MF-05 demo:term-end prints "0 to RETURN_DUE" | Notice was not given first, so the term renewed. Give notice, then run it again | `demo-term-end.ts:13-14, 71-75` |
| MF-05 close refused "This cannot be done while it has open incidents." | You are on RC-2026-0001. Use RC-2026-0002 | `ReturnCounter.tsx:357`, `seed-demo.ts:524-528` |
| Anything else, between flows | Full reset of the local database, about two minutes (below), then sign in again in every window | |

Fallback SOS for an UNROUTED incident (TL-0002, node `0xde000002` = 3724541954), with Mosquitto
running, from `docs/sessions/2026-10-30-0904-incident-authority-reports.md:126-135`
**(unverified)**:

```bash
mosquitto_pub -h localhost -p 1883 -q 1 -t 'treklink/2/json/LongFast/!de000002' \
  -m "{\"id\":$(date +%s),\"timestamp\":$(date +%s),\"to\":4294967295,\"from\":3724541954,\"channel\":0,\"type\":\"text\",\"sender\":\"!de000002\",\"payload\":{\"text\":\"SOS - HELP\"}}"
```

Full reset of the **local** database (destroys every row in it; stop `npm run dev` first). The
backend has no Prisma seed hook, so the demo seed is run separately (`backend/package.json`):

```bash
cd backend && npx prisma migrate reset --force --skip-seed && npm run seed:demo && cd ..
```

**(unverified: `migrate reset` was not run for this document; on a Docker volume problem use
`docker compose down -v` then `docker compose up -d`, `prisma:deploy` and `seed:demo` from §1.2.)**

Second records to fall back on without a reset:

| Flow | Primary | Fallback |
|---|---|---|
| MF-01 | RC-2026-0004 (five v3) | A second request of five v3 (RC-2026-0005). Stay on v3: only two v2 and two v4 units exist, below the minimum of five |
| MF-03 operator path | TL-0010 SOS (`sos`) | TL-0010 `sos-fall`, or set `GATEWAY_SIM_SOS_EVERY=1` and restart the gateway for an SOS from TL-0009 |
| MF-03 step 7 | Seeded UNROUTED incident on TL-0001 | The TL-0002 SOS above |
| MF-03 step 11 | Seeded DEFAULTED RC-2026-0003 | None without a reset: no other contract is DEFAULTED, and the overdue and default jobs take days (`rentals.defaultAfterDays` 7) |
| MF-05 | RC-2026-0002 | RC-2026-0001, only if its MF-03 incident is Closed (reopen window ended) |

---

## 9. Timing (one page)

| Flow | Minutes | Who presents |
|---|---|---|
| Opening, architecture in one slide, windows signed in | 3 | |
| MF-01 request to handover, Field Station credential | 9 | |
| MF-02 device data through the Field Station bridge, sync status | 5 | |
| MF-03 SOS to incident, authority reports on an incident and a contract | 9 | |
| MF-04 live map, organization API | 4 | |
| MF-05 term end to close | 9 | |
| Disclosures (if not already covered) | 2 | |
| Questions and buffer | 4 | |
| **Total** | **45** | |
