# Demo script, supervisor meeting 2026-11-01 (MF-01 to MF-05)

Prepared 2026-10-30 by KhoaDD under D-078, from `dev` at `cdaecf1`; refreshed on `dev` at `ca7711c`
(#128 plans page, #135 organization lifecycle, #147 sync status page, #149 DEFAULTED contract seed,
#150 incidents figures), with every changed step cited again; checked again on `dev` at `c5cd3a2`
against the code and the demo smoke record (`docs/sessions/2026-10-30-1830-demo-smoke.md`); corrected
on 2026-10-30 from the second demo smoke (`docs/sessions/2026-10-30-2200-demo-smoke-2.md`), which
clicked the steps it lists in a browser; corrected again from the leader's in-person dry run of onboarding
and MF-01 on 2026-10-30 (MF-01a added, MF-01 steps 6, 9 and 11, setup §1.2). Every step names the
source it was traced to, as `file:line`.
A step marked **(unverified)** could not be traced to code or to a handoff that ran it.

> [!IMPORTANT]
> **Clicked in a browser on 2026-10-30**, at 1280 px in headless Chromium on a fresh seed: MF-01
> steps 0 to 14, MF-02 steps 3 and 4, MF-03 steps 2 to 13, MF-04 steps 2 and 4, and MF-05 steps 1 to
> 10 (second demo smoke, §3 and its continuation). The other steps are traced to the code, the demo
> seed and the 2026-10-30 handoffs. That browser ran in UTC, so its times read seven hours behind the
> laptop. Rehearse the whole script once on Saturday against a fresh seed, on the laptop and browser
> used on Sunday, and correct this file where the screen differs.

The five main flows, as `specs/README.md:25-31` maps them to modules:

| Flow | What it shows | Modules |
|---|---|---|
| MF-01a | Onboarding: an organization registers, Staff verify it, an Admin approves it, its Manager sets a password | organizations, auth |
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

> [!CAUTION]
> **Never run `seed:demo`, `prisma migrate reset` or any other reset from a checkout whose `.env`
> points `DATABASE_URL` at the shared Neon dev database.** The seed writes demo rows into whatever
> database `DATABASE_URL` names, and a reset destroys every row in it; the shared dev database is the
> whole team's (D-010, D-062). Use a local Postgres for the demo, the Docker one below or a local
> install. Check first: the host in `DATABASE_URL` and `DATABASE_DIRECT_URL` must be `localhost` (a Neon
> host ends in `neon.tech`) (`.env.example:4-19`).

Install once on the demo laptop, at the root (npm workspaces; there is no per-package lockfile):

```bash
npm ci
```

**On npm 11, install scripts are skipped** (found on the demo laptop in the dry run of 2026-10-30), so
four dependencies are left unbuilt: `bcrypt` (backend password hashing, `backend/package.json:42`),
`prisma` and `@prisma/client` (`backend/package.json:41, 74`), `better-sqlite3` (the gateway queue,
`gateway/package.json:16`) and `esbuild` (the frontend build). Approve their scripts and rebuild them;
**(unverified: the exact npm 11 command was not run here, this container has npm 10)**:

```bash
npm approve-scripts bcrypt better-sqlite3 esbuild prisma
```

```bash
npm rebuild bcrypt better-sqlite3 esbuild prisma
```

```bash
npm --prefix backend run prisma:generate
```

If `approve-scripts` is not a command in the installed npm, run `npm help approve-scripts` or check
`npm help config` for the install-script setting of that release, and use its equivalent. Without the
rebuild `bcrypt` and `better-sqlite3` have no native binding, so the backend and the gateway fail when
they load them **(unverified)**; without `prisma:generate` the seed fails with "@prisma/client did not
initialize yet" (`docs/sessions/2026-10-30-2200-demo-smoke-2.md`, Environment).

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

**ORG-0002 is the organization registered live in MF-01a.** The code is `ORG-` and one more than the
highest number in use (`backend/src/modules/organizations/organizations.repository.ts:84-90`); the seed
holds only ORG-0001. A rehearsal without a reset moves it to ORG-0003 and on, and a second registration
with the same tax code or Manager email is refused with "This tax code is already registered."
(`backend/src/modules/organizations/organization-onboarding.service.ts:93-100`).

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
| D | `admin@treklink.local` (`SEED_ADMIN_PASSWORD`) | `/t/map` | MF-01a approval; Swagger parameter change for MF-03; MF-05 tail |
| E | Not signed in: a new tab | `/` or `/register` | MF-01a registration and the new Manager's first sign-in |

Plus one terminal at the repository root for `replay:mqtt` and `demo:term-end`.

> [!WARNING]
> **Do not reload a page or type a URL into the address bar.** The session is held in memory only and
> nothing is written to `localStorage` (`frontend/src/entities/session/model.ts:37-38`), so a reload
> signs that window out; sign in again and the guard returns you to the page (`router.tsx:45-58`).
> Move with the sidebar and the links. Each window, or tab, keeps its own session.

---

## 2a. MF-01a: onboarding, register to the Manager's first sign-in (about 4 minutes)

Run on the leader's dry run of 2026-10-30; the steps below are traced to the code on `dev`. The new
organization is ORG-0002 (§1.3). MF-01 then continues with the seeded ORG-0001, whose devices, Field
Station and contracts the later flows use; ORG-0002 rents nothing in this demo.

| # | Window | Page and click | Expected on screen | Source |
|---|---|---|---|---|
| 1 | E (not signed in) | Plans page `/`, **Register your organization** (or `/sign-in`, **Register your organization**) | "Register your organization" with seven fields and the SAR disclaimer | `frontend/src/pages/PlansPage.tsx:89`, `SignInPage.tsx:124-126`, `RegisterPage.tsx:19-27, 109-139` |
| 2 | E | Registered company name **Phan Dung Trekking Co., Ltd.**, Tax code **0312345678** (10 or 13 digits, not ORG-0001's `0000000001`), Registered address, Company phone, Manager full name **Tran Van Binh**, Manager email **binh.manager@example.com**, Manager phone; **Register** | "Registration received. Visit the TrekLink counter or call us to verify your organization."; "Your organization code is **ORG-0002**. The Manager receives an email to set a password." | `RegisterPage.tsx:86-98`; seed tax code `backend/prisma/seed-demo.ts:277`; the invitation is issued in the same transaction and mailed after commit (`backend/src/modules/organizations/organization-onboarding.service.ts:90-92`, `backend/src/modules/auth/accounts.service.ts:252-286`) |
| 3 | B Staff | Sidebar **Organizations** (`/t/organizations`), tab **Pending**, row **ORG-0002** | Detail: code, tax code, address, contact; "Counter verification" form | `OrganizationReviewPage.tsx:48-49, 520-534, 548-556`; nav `frontend/src/shared/config/navigation.ts:121` |
| 4 | B | Counter verification: Method **In person**, tick **Business registration** and **Manager ID card**, Master contract number **MC-2026-0002**, tick **The master contract includes the signed NDA** and **... the Field Station software licence**, **Record verification** | Toast "Saved."; the detail adds "Verified ..., in person, contract MC-2026-0002"; the button reads **Update verification**. Staff see no Approve button: approval is an Admin decision | `OrganizationReviewPage.tsx:56, 61-157, 535-540, 548-557` |
| 5 | D Admin | Sidebar **Organizations**, tab **Pending**, row **ORG-0002**, Decision **Approve** | Toast "ORG-0002 approved. The Manager can now request devices."; the row leaves Pending. **Approve** is disabled until step 4 is recorded ("Verify this organization at the counter before approving it.") | `OrganizationReviewPage.tsx:396-410, 557-581` |
| 6 | Terminal (the `npm run dev` log) | Find the `[backend]` line `[Mail] ... to=binh.manager@example.com subject="Your TrekLink invitation code"` and read the code in its text | `text="Your TrekLink invitation code is <code>. It is valid for 72 hours. Open TrekLink, choose \"Set password\" and enter it with your new password."` | `MAIL_TRANSPORT=console` writes each email to the log (`backend/src/modules/auth/mail/console.transport.ts:11-16`); text `backend/src/modules/auth/password-flows.service.ts:33-43`; 72 hours is `auth.invitationTtlHours` (`backend/prisma/migrations/20261004120100_seed/migration.sql:10`) |
| 7 | E | `/sign-in`, **Set password** | `/welcome`, "Welcome to TrekLink" with Email, Invitation code, Password, Confirm password | `SignInPage.tsx:120-123` (link added on `dev` in `f9fc055`), `WelcomePage.tsx:50-100` |
| 8 | E | Email **binh.manager@example.com**, the code from step 6, a password of at least 8 characters twice, **Set password and sign in** | Signed in as the ORG-0002 Manager on `/o`, the organization overview | `WelcomePage.tsx:37-39`, landing `frontend/src/entities/session/model.ts:64-73`; `auth.passwordMinLength` 8 in `migration.sql:5` |

Say during step 6: the code is in the log because mail goes to the console in this demo (§7, Email
delivery); with an SMTP server it arrives by email. If the Manager email or tax code was used in a
rehearsal, register with another one (§1.3).

---

## 2b. MF-01: request to handover (about 9 minutes)

| # | Window | Page and click | Expected on screen | Source |
|---|---|---|---|---|
| 0 (optional) | Any window before sign-in | The public plans page at `/` (also `/plans`) | "Rent TrekLink devices", the monthly and day price per variant with a "Sandbox price" badge, "How renting works", **Register your organization** and **Sign in** | `frontend/src/app/router.tsx:87-88`; `frontend/src/pages/PlansPage.tsx:44, 87-110, 191-202` |
| 1 | A Manager | Overview `/o`, **Request a contract** | The request page with three steps: Plan and devices, Start date, Review and send | `OrgDashboardPage.tsx:187-188`, `ContractRequestPage.tsx:24, 232` |
| 2 | A | Plan **Monthly**, Hardware variant **TrekLink v3 (GPS, SOS button), 450,000 VND per device per month**, Quantity **5**, **Next** | The Quote panel shows the term fee for one month; the quantity hint reads "At least 5 devices." | `ContractRequestPage.tsx:304, 332, 335, 349, 351-356, 439` (the option reads the variant name and price, not the code `treklink-v3`; name `seed-demo.ts:152`); `rentals.minOrderQuantity` 5 in `backend/prisma/migrations/20261004120100_seed/migration.sql:22` |
| 3 | A | Start date (handover day): **today**, **Next** | Today is the earliest date allowed | `ContractRequestPage.tsx:375-385` |
| 4 | A | Review, **Send request** | Toast "Request sent. TrekLink will confirm availability and your handover appointment."; the new contract page opens with code **RC-2026-0004**, Requested | `ContractRequestPage.tsx:28, 145-146, 448` |
| 5 | B Staff | Sidebar **Contracts** (`/t/contracts`), tab **Requested**, click **RC-2026-0004** | Side panel: plan, devices, prices; status line "10 treklink-v3 available now; approval reserves 5." | `ContractApprovalPage.tsx:41-45, 228-237, 456-476`; ten v3 units in `seed-demo.ts:185-192` |
| 6 | B | Handover appointment: it opens on today 09:00 local; **after 09:00 change it to a time later today** (for example the next full hour), then **Approve** | Toast "RC-2026-0004 approved. 5 devices reserved."; a green box "Reserved: TL-00xx, ..." (five tags chosen by the server) and "Reservation expires ...". An appointment in the past is refused under the field: "The handover appointment is in the past. Choose a time from now on." (dry run 2026-10-30, rentals REQ-ERR-09). A later appointment today does not hold up the handover, which checks only the start date | `ContractApprovalPage.tsx:50, 159-174, 217-222, 257-275`; refusal `backend/src/modules/rentals/contract-decisions.service.ts` (approve, REQ-ERR-09); handover day check `backend/src/modules/rentals/handover.service.ts:212` |
| 7 | B | In the same panel **Open the contract**, then **Open the counter** | "Counter handover: RC-2026-0004" with four steps: Devices, Payment, Preview note, Sign | `ContractApprovalPage.tsx:284-285`, `ContractDetailPage.tsx:49-57, 459-463`, `CounterPage.tsx:39, 407-412` |
| 8 | B | Step 1 Devices: type a reserved tag (for example TL-0011) in **Scan or type an asset tag**, **Find**; then on each of the five rows **Record provisioning**, Battery % **90**, tick **GPS fix**; **Next** | The found row is highlighted, "TL-00xx is on this contract."; each row reads "Provisioned v1" | `CounterPage.tsx:212-220, 466-490, 520-575`; checks in `CounterPage.tsx:243-268`; minimum battery 50 % in `migration.sql:16` |
| 9 | B | Step 2 Payment: **Record a counter payment**; the dialog reads "Due now: **1,125,000 VND**. Due later: **1,125,000 VND**" and Amount received is prefilled with **1125000**; Method **Cash**, a receipt number, **Record** | "The first payment is recorded." Due now is the holding fee, 5 x 450,000 VND x 0.5 = 1,125,000 VND, due at the term start; Due later is the term balance, due at the term end, shown apart so the prefill never prepays it | `CounterPage.tsx:624, 637`; `frontend/src/widgets/InvoiceDetail/CounterPaymentDialog.tsx:14-20, 40-43, 96-104` (`c319812`); lines and due dates `backend/src/modules/billing/invoices.service.ts:64-103`; `billing.holdingFeeRatio` 0.5 in `migration.sql:28`, formula `backend/src/modules/billing/money.ts:24-30`. Before 09:00 local on the start day the holding fee is not due yet: Due now reads 0 VND and the prefill is the whole 2,250,000 VND; type **1125000** then |
| 10 | B | **Next**, Step 3 Preview note | The unsigned handover note renders in a frame ("Handover note preview, not signed") | `CounterPage.tsx:645-665` |
| 11 | B | **Next**, Step 4 Sign. The signer is the organization's Manager, not the Staff member: Signing Manager lists only ORG-0001's active Managers, choose **Demo Manager** (`manager@treklink.local`); Identity document checked "CCCD, last 4 digits 1234"; hand the screen to the Manager, who signs in the box; **Complete handover** | Toast "Handover complete. 5 devices issued under contract RC-2026-0004."; page "Handover of RC-2026-0004", "5 devices issued. The contract is active and the signed note is stored." | `CounterPage.tsx:190-192, 682-700, 750`; the server refuses any other signer: "The signer must be an active Manager of the organization." (`backend/src/modules/rentals/handover.service.ts:228`) |
| 12 | B | **Open the contract and the handover note** | Contract page, Active, Handed over today | `CounterPage.tsx:370-372`, `ContractDetailPage.tsx:267` |
| 13 | A Manager | Sidebar **Field stations** (`/o/field-stations`): the seeded "Ta Nang basecamp laptop" is already listed. **Create Field Station**, Name "Phan Dung ranger post", **Create** | Dialog "Credential for Phan Dung ranger post": Broker URL, Username **fs-org-0001-2**, Secret, each with Copy; "Copy it now; it will not be shown again." | `FieldStationsPage.tsx:150-165, 224-240, 347`; seeded station `seed-demo.ts:1011-1033`; username rule in §1.3 |
| 14 | A | **Done** | Two rows, both Active; the new one shows Last sync "No data yet"; the count line reads "2 of 5 active stations" (", N revoked" is added only when a credential was revoked), and **Create Field Station** is disabled at 5 | `FieldStationsPage.tsx:44-63, 231, 327-336, 343`; limit 5 in `migration.sql:14` |

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
| 4 | B Staff | Sidebar **Field data sync** (`/t/admin/sync`, group Fleet) | "Field data sync": cards MQTT subscriber UP, Accepted (last 60 min), Duplicates rejected, Unknown device; the Field Stations table lists "Ta Nang basecamp laptop", TrekLink Demo Tours Co., Ltd., **Connected**, its Last sync and Last flush, Queue depth (P0 to P3) "0, 0, 0, 0"; Recent field events list TL-0009 and TL-0010 with Ingress "Node uplink" and Attribution "Attributed" | `frontend/src/app/router.tsx:130`, `frontend/src/shared/config/navigation.ts:111`, `frontend/src/pages/SyncStatusPage.tsx:15-27, 39-169`; Connected while the last report is under `monitoring.fieldStationStaleSeconds` (180 s), `backend/src/modules/gateway-sync/sync-status.service.ts:59-66`, `migration.sql:49`; organization legal name `sync-status.service.ts:100`; the simulator's packets arrive on the node topic, `backend/src/modules/gateway-sync/adapters/node-json.adapter.ts:32`. Needs `GATEWAY_FS_USERNAME=fs-org-0001-1` (§1.1). The page reads `POST /api/gateway-sync` with `{ "op": "syncStatus" }`, an operation, not a GET (`frontend/src/entities/gateway-sync/api.ts:4, 48-50`); Staff and Admin 200, Manager and Operator 403 |
| 5 | B | Change Window to another value, **Refresh** | The Accepted count grows with each refresh while the gateway runs | `SyncStatusPage.tsx:44-66, 82` |
| 6 (optional) | Terminal | Outage: `docker compose stop mosquitto`, wait about 20 s, `docker compose start mosquitto`, then **Refresh** on the sync page | A Refresh during the outage shows MQTT subscriber **DOWN** (red), the station still **Connected** (20 s is under the 180 s stale limit) and the queue depth of its last report, because no health report is sent while the uplink is down. After the restart the backend subscriber reconnects within 5 s and shows **UP**; the gateway reconnects within 3 s, flushes the queue in tier order (SOS first) and, once drained, sends a health report at once, so Last flush moves to the reconnect time, depth reads "0, 0, 0, 0" and Accepted grows by the queued packets; the map markers catch up | Simulator packets go through the SQLite queue, `gateway/src/index.ts:13-26`; flush on connect `gateway/src/mqtt/mqtt-client.ts:30-36`, reconnect every 3 s `gateway/src/config.ts:67-68`; drain then health report `mqtt-client.ts:63-83, 106-115`; subscriber reconnect 5 s and up or down `backend/src/modules/gateway-sync/mqtt/mqtt-subscriber.ts:60`, `sync-status.service.ts:91`, card `SyncStatusPage.tsx:78-80`; stale rule `sync-status.service.ts:59-66`; `specs/gateway-sync/tasks.md:115` ("2 SOS, 12 positions and 12 telemetry readings queued with the broker down, flushed SOS first"). Traced in code; watch it once at the Saturday rehearsal |

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
`GET /api/parameters?ownerModule=incidents`: a page `{ items, pageNumber, pageSize, totalCount,
totalPages }` whose items carry `key`, `value` and `version` (`parameter-reads.service.ts:35-40`,
`parameter.repository.ts:6-16`). With the defaults
(120 s per tier) the happy path below still works; only escalation is slower.

| # | Window | Action | Expected | Source |
|---|---|---|---|---|
| 1 | Terminal | `npm --prefix backend run replay:mqtt -- sos --now --new-ids`, at least 5 minutes after `seed:demo` | One SOS packet from TL-0010 (`!de00000a`), RC-2026-0001. Earlier than 5 minutes the SOS falls inside `gatewaySync.attributionMarginSeconds` (300 s) of the seeded handover, opens an UNROUTED incident, and later SOS packets from that unit join it | `backend/test/fixtures/mqtt/sos.json`; replay `backend/test/harness/replay.ts:1-12`; margin `migration.sql:36`; demo smoke `docs/sessions/2026-10-30-1830-demo-smoke.md` §2 MF-02 and §5 |
| 2 | C Operator | Any page | Red banner on every page: "SOS: TL-0010 (Pham Van F), hh:mm. Acknowledge now." with **Acknowledge** | `frontend/src/app/AlertBanner.tsx:20-31, 38-60, 132`; holder label `seed-demo.ts:85-88`; routed to the Operator as primary, `seed-demo.ts:318-319` |
| 3 | C | Sidebar **Incidents** (`/o/incidents`), click the new code | Incident page: Device TL-0010, Holder Pham Van F, Owner Unclaimed, state Notifying primary, last known coordinates | `IncidentsPage.tsx:35, 102-122`; `IncidentDetailPage.tsx:234-262`; label `shared/ui/status.ts:168` |
| 4 | C | **Acknowledge** | Toast "Saved."; Owner Demo Operator, state Acknowledged; the banner clears | `IncidentDetailPage.tsx:156-162, 178-186, 207-221`; `AlertBanner.tsx:61-63` |
| 5 | C | **Response under way**, What is being done "Ranger team dispatched from the Ta Nang post", **Save response**; then **Add status**, a line, **Save status** | State Responding; the status update appears with the author and time | `IncidentDetailPage.tsx:51-57, 310-325` |
| 6 | C | **Report outcome**, Outcome "Hiker found, minor ankle injury, walked out", **Resolve incident** | State Resolved; History shows each step with the actor | `IncidentDetailPage.tsx:58-62`; History panel `docs/sessions/2026-10-30-0710-hoangtk-tk145-incident-history-panels.md:31-35` |
| 7 | B Staff | Sidebar **Incidents** (`/t/incidents`), filter **Unrouted and escalated**, click the seeded incident on **TL-0001** | Inline detail: Device TL-0001, Holder "No holder label", Owner "TrekLink Staff queue", state Unrouted | `StaffIncidentsPage.tsx:25-31, 52-70`; seed `seed-demo.ts:783-838` |
| 8 | B | **Report to authorities**, fill Agency "Lam Dong Provincial Police", Authority reference "LD-2026-1101", **type** Reported at (it starts empty; now, not in the future), **Record report** | Badge "Reported to authority" | `StaffIncidentsPage.tsx:86`; `AuthorityReports.tsx:305, 317-389`; Reported at starts empty, `AuthorityReports.tsx:159, 372-386`; `status.ts:174`; `docs/sessions/2026-10-30-0904-incident-authority-reports.md:137-145` |
| 9 | B | Tab **Authority reports**, **Record case closed** on the row, **type** Closed at (it starts empty; after the report time and not in the future), confirm | Toast; with **Open cases only** ticked the row leaves the list | `AuthorityReports.tsx:468-481, 556, 638`; Closed at starts empty, `AuthorityReports.tsx:420, 496`; handoff `2026-10-30-0904-incident-authority-reports.md:143-145` |
| 10 | B | **View incident** | The TL-0001 incident is Closed | `AuthorityReports.tsx:607`; handoff `2026-10-30-0904-incident-authority-reports.md:145` |
| 11 | B | Back on **Incidents**, tab **Authority reports**, **Record report**; Subject kind **Defaulted contract** | "Only defaulted contracts can be reported."; one eligible record, **RC-2026-0003, TrekLink Demo Tours Co., Ltd.**, state Defaulted | `AuthorityReports.tsx:78-123, 549-551`; DEFAULTED contracts listed by `frontend/src/entities/incident/authorityReports.ts:64-67`; label `status.ts:95`; seed `seed-demo.ts:840-988` |
| 12 | B | Click **RC-2026-0003**; Agency "Lam Dong Provincial Police", Authority reference "LD-2026-1102", Reported at now, Note "Device TL-0019 not returned after default", **Record report** | Toast "Saved."; a new row in the Authority reports list whose Subject column reads **View contract** (the "Contract report" label shows only on a phone-width card) | `AuthorityReports.tsx:37, 40, 132-143, 257, 305, 597-612` |
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

The demo smoke of 2026-10-30 (`docs/sessions/2026-10-30-1830-demo-smoke.md` §2 MF-04, §3 and §5
step 4) ran this flow: `operator@` on Live map, `staff@` on Fleet map, every page at 1280 px and
360 px with no console error or failed call. Over HTTP, `GET /api/map/config` and
`GET /api/map/snapshot` answered 200 for Operator, Manager, Staff and Admin, and
`GET /api/telemetry/devices` with the seeded `X-Api-Key` answered 200. The gateway keeps running
from MF-02.

| # | Window | Action | Expected | Source |
|---|---|---|---|---|
| 1 | C Operator | Sidebar **Live map** (`/o/map`) | Header "Live map", "N devices, 0 SOS open, 0 stale"; the devices in custody: RC-2026-0001's TL-0009 and TL-0010, RC-2026-0002's TL-0017 and TL-0018 until MF-05 returns them, RC-2026-0003's TL-0019 (DEFAULTED keeps its device visible) and, after MF-01, RC-2026-0004's five units; those without a report show "No position yet" | `LiveMapPage.tsx:212, 248-253`; "No position yet" `LiveMapPage.tsx:62`; custody rule `backend/src/modules/rentals/contracts.service.ts:244-250`; smoke §5 step 4 |
| 2 | C | Type "TL-0010" in **Search asset tag, holder or contract** | One row: TL-0010, Pham Van F, battery | `LiveMapPage.tsx:257-266, 117-137` |
| 3 | C | Point at the Vietnamese sovereignty overlay and the attribution on the map | Hoang Sa and Truong Sa labels drawn over the OpenStreetMap tiles (D-031) | `frontend/src/shared/config/map.ts`, `widgets/LiveMapWidget/LiveMapWidget.tsx` **(unverified: the smoke record does not name the overlay; look for it at the Saturday rehearsal)** |
| 4 | B Staff | Sidebar **Fleet map** (`/t/map`), Organization filter **All organizations**, then ORG-0001 | "Fleet map", every organization's devices; the filter narrows to ORG-0001 | `LiveMapPage.tsx:90-104, 212, 252-253`; smoke §5 step 4 |
| 5 (optional) | Terminal | `curl -s -H "X-Api-Key: $SEED_ORG_API_KEY" http://localhost:3000/api/telemetry/devices` | 200 with ORG-0001's devices in the `{ result, isSuccess, statusCode, message }` envelope, for the organization's own systems | `backend/src/modules/monitoring/org-api.controller.ts:28, 44-51`; key `seed-demo.ts:990-1008`; 200 in smoke §2 MF-04 (the body was not recorded) |
| 6 (optional) | B Staff | `/t/devices/<TL-0009 id>` from **Devices** | The device history (monitoring api-design 07); it is Staff and Admin only, 403 for an Operator or Manager | smoke §2 MF-04 (`GET /api/devices/:id/history` 200 for Staff and Admin, 403 for Operator and Manager) |

Talking point: a device that sends nothing for `monitoring.deviceStaleSeconds` (300 s) shows a
Stale badge (`migration.sql:48`, `LiveMapPage.tsx:129`).

---

## 6. MF-05: term end to close on RC-2026-0002 (about 9 minutes)

Steps 1 to 10 were clicked in the browser by the second demo smoke (continuation, MF-05 table), with
the reset checked again after a reload; steps 1 to 6 were first verified over HTTP in
`docs/sessions/2026-10-30-0903-devices-retire-dispose.md:71-88`. `ReturnCounter.tsx` below is
`frontend/src/widgets/ReturnCounter/ReturnCounter.tsx`. RC-2026-0002 is used, not RC-2026-0001, because
the MF-03 SOS sits on RC-2026-0001's TL-0010 and a contract with an open incident cannot close
(409 `OPEN_INCIDENTS`, `backend/src/modules/rentals/return.service.ts:235, 275`; `seed-demo.ts:524-528`).

| # | Window | Action | Expected | Source |
|---|---|---|---|---|
| 1 | A Manager | Sidebar **Contracts** (`/o/contracts`), **RC-2026-0002**, **Give notice**; dialog "Give notice on RC-2026-0002?", **Give notice** | Toast "Notice recorded. The contract ends on <term end>; 0 VND is due then."; badge Ending; "Notice given" with the time; History "Active to Ending: NOTICE" | `ContractDetailPage.tsx:286-288, 450-453`; `NoticeDialog.tsx:35, 52, 83` |
| 2 | Terminal | `npm --prefix backend run demo:term-end -- RC-2026-0002` | Prints "RC-2026-0002: MONTHLY, ENDING", "Term 1 now ends ... (was ...)" and "Term rollover: 0 renewed, 1 to RETURN_DUE, 0 to RETURNED." The term ends one minute before the latest 09:00 UTC+7 rollover cutoff, so Return due reads 08:59 today (or yesterday, before 09:00). A `[JobRunnerService]` error stack may follow on rare runs; the "Term rollover:" line is what counts | `backend/prisma/demo-term-end.ts:24-27, 76, 93-98, 120-123`; notice first or the term renews, `demo-term-end.ts:13-14, 77-81`; stack seen once in eight runs, smoke 2 defect 5 |
| 3 | B Staff | **Contracts**, tab **All**, row RC-2026-0002, **Open the contract** in the side panel, **Open the counter** | Contract page: Return due, History "Ending to Return due: TERM_ENDED". Counter: "Counter: RC-2026-0002", badge Return due, "..., return due <date>", tabs Check-in 2, Reset and inspection 0, Close | `CounterPage.tsx:378-398`; `ReturnCounter.tsx:412-425`; `ContractDetailPage.tsx:291-293, 460-464` |
| 4 | B | Check-in: type **TL-0017**, **Add**, type **TL-0018**, **Add**, **Check in 2 devices** | "Check-in complete. 2 of 2 devices returned."; badge Returned; the Reset and inspection tab counts 2 | `ReturnCounter.tsx:322-352, 418-422, 442-479` |
| 5 | B | Reset and inspection: on each row **Record reset**, tick Channel key removed, Node database cleared, Owner name cleared, **Record reset**; then **Inspect** TL-0017, **Passed**, **Record inspection** | Toast "Saved." per reset; each row "Reset logged <time>" with **Inspect**; then TL-0017 "Passed, available" | `ReturnCounter.tsx:48-52, 89-122, 175-204, 405, 491-514` |
| 6 | B | **Inspect** TL-0018, **Damaged**, tick "Casing cracked (CASING_CRACKED)" 400,000 VND, **Record inspection** | TL-0018 "Damaged, maintenance" and "Damage 400,000 VND, on the closing invoice" | `ReturnCounter.tsx:205-262, 389-398`; rate `seed-demo.ts:166-169`; handoff `2026-10-30-0903-devices-retire-dispose.md:80-82` |
| 7 | B | Tab **Close**: Due now 400,000 VND, Due later 0 VND, Paid 900,000 VND; **Open the invoices** (`/t/billing`, "Showing one contract."), click the row of Kind **CLOSING** (INV-2026-000002 on a fresh seed; a later number after MF-01), **Record counter payment**, Method **Cash**, Amount received (VND) **400000**, Receipt number or bank reference, **Record** | Toast "Payment of 400,000 VND received."; Paid 400,000 VND, Still due 0 VND; the line "Damage to TL-0018: CASING_CRACKED" Paid | `ReturnCounter.tsx:518-556`; `frontend/src/pages/InvoicesPage.tsx:17`; `InvoiceDetailView.tsx:103-133`; `CounterPaymentDialog.tsx:57, 79-133` |
| 8 | B | **Contracts**, tab **All**, RC-2026-0002, **Open the contract**, **Open the counter** (a RETURNED contract opens on the Close tab), **Close contract**; dialog "Close contract RC-2026-0002?", **Close contract** | Toast "Saved."; badge Closed; "This contract is closed." | `ReturnCounter.tsx:287-289, 354-371, 538-548, 595-608`; handoff `2026-10-30-0903-devices-retire-dispose.md:83-84` |
| 9 (optional) | B | Sidebar **Devices** (`/t/fleet`), chip **Maintenance**, **TL-0018** (Open maintenance "Open, Inspection damaged: CASING_CRACKED."); sidebar **Maintenance**, row TL-0018 **Complete**: Status **Completed**, type a Resolution (required), Actual cost **0**, checklist optional, **Save**; in the alert **Open TL-0018**, **Record intake check** (GPS fix, Radio, Battery are on), **Save** | Alert "TL-0018 stays in maintenance until it passes an intake check on its page."; after the intake check TL-0018 Available | `frontend/src/pages/MaintenancePage.tsx:365-440, 866-882`; `frontend/src/pages/DeviceDetailPage.tsx:127-132, 328`; `docs/sessions/2026-10-30-0922-fleet-maintenance-pages.md:109-119`; threshold 1,000,000 VND `migration.sql:20` |
| 10 (optional) | B then D Admin | `/t/maintenance`, **Open maintenance**, Search **TL-0008**, Device TL-0008, **Continue**, type Description and **Expected completion** (both required), **Open maintenance**; row TL-0008 **Complete**, **Unrepairable**, Resolution, **Save**, confirm **Mark unrepairable**; as Admin **Devices**, **TL-0008**, **Retire** with a reason, then **Dispose** (tick Key removed, Node database cleared, Owner cleared, type a Method) | "TL-0008 stays in maintenance until an Admin retires it."; TL-0008 Retired, then Disposed | `docs/sessions/2026-10-30-0903-devices-retire-dispose.md:85-88`. The handoff used TL-0011; use **TL-0008** (treklink-v4) because the MF-01 approval may have reserved TL-0011, a v3 unit |

Step 3: the approval queue's default tab is Requested; RC-2026-0002 is under **All**
(`ContractApprovalPage.tsx:41-45`). The Return due date shows in the counter header
(`CounterPage.tsx:395`).

Step 5, if asked whether the reset is stored: it is read back from the contract, so a reload keeps it
(`ReturnCounter.tsx:278-282, 310-311`). The smoke reloaded the counter, signed in again and saw both
rows still "Reset logged". Do not reload during the demo (§1.4); say it instead.

---

## 7. Disclosures: what is simulated or not built

Say these before anyone asks. Each is a one-line answer.

| Item | State in the code | What the presenter says |
|---|---|---|
| Physical serial reader | The gateway runs in simulation mode; the `FromRadio` decoder for a radio on USB is open (gateway-sync 5.1) | "Today the Field Station bridge simulates two nodes on the seed's node numbers. The queue, the priority order and the MQTT path are the real code; reading a real radio over USB is the remaining part of task 5.1." (`gateway/src/config.ts:85-89`, `specs/gateway-sync/tasks.md:111-115`) |
| Field Station credential at the broker | Issued and stored as a bcrypt hash; the local Mosquitto runs without authentication and no caller checks the credential yet. The gateway names its station only in the health report topic (`GATEWAY_FS_USERNAME`); the seeded station's secret is random and discarded | "The credential is issued and shown once. The broker-side check of it is gateway-sync 3.1; this demo broker is open." (`field-stations.service.ts:82-86, 220-227`, `docker-compose.yml:30-31`, `seed-demo.ts:1011-1015`) |
| Field Station event topic | The gateway still publishes device packets on each node's own uplink topic (Stage B); only its health report uses the station topic, so Recent field events show Ingress "Node uplink" | "Packets travel on the node topic today; the station's own event topic arrives with the station adapter." (`specs/gateway-sync/tasks.md:115`, `SyncStatusPage.tsx:160`) |
| Organization suspend, reactivate and close (#135, #156) | Served by the backend (`POST /api/organizations/:id/suspend`, `reactivate`, `close`, with CASL policies) and, for an Admin, by **Suspend**, **Close organization** and **Reactivate** on the organization review page `/t/organizations`. **Do not suspend ORG-0001 during the demo**: a request from a non-ACTIVE organization is refused, and on `dev` at `a4c4bf6` a reactivation answers 409 `BALANCE_OUTSTANDING` while any invoice line is unpaid, including RC-2026-0004's second line that is not due until a month after MF-01. The leader's ruling of 2026-10-30 (only due and unpaid lines block it) is on `fix/review-follow-ups-backend-1030` and not merged yet | "An Admin suspends, reactivates or closes an organization from its review page; reactivation needs everything due to be paid." (`backend/src/modules/organizations/organization-status.controller.ts:23-49`, `frontend/src/pages/OrganizationReviewPage.tsx:222-240, 591-625`, `backend/src/modules/rentals/contracts.service.ts:99`; smoke 2 §2 and continuation) |
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
| MF-05 demo:term-end prints "0 to RETURN_DUE" | Notice was not given first, so the term renewed. Give notice, then run it again | `demo-term-end.ts:13-14, 77-81` |
| MF-05 demo:term-end prints "RC-2026-0002 has no open term." | It already ran: the term is closed and the contract is RETURN_DUE. Go on with step 3 | `demo-term-end.ts:83-88` |
| MF-05 demo:term-end prints a `[JobRunnerService]` error stack | A scheduled job of the script's own process; read the "Term rollover:" line above it and go on if it says "1 to RETURN_DUE" | smoke 2 defect 5 |
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
| MF-01a onboarding, register to the Manager's first sign-in | 4 | |
| MF-01 request to handover, Field Station credential | 9 | |
| MF-02 device data through the Field Station bridge, sync status | 5 | |
| MF-03 SOS to incident, authority reports on an incident and a contract | 9 | |
| MF-04 live map, organization API | 4 | |
| MF-05 term end to close | 9 | |
| Disclosures (if not already covered) | 2 | |
| Questions and buffer | 4 | |
| **Total** | **49** | |
