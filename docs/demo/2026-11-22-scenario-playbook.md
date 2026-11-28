# Scenario playbook, main flows MF-01 to MF-05 (D-109)

Jira TK-229. Written 2026-11-20 on `dev` at `8744a0d6` for the rehearsals after the staging reseed of
Saturday 2026-11-21. Decision D-109 requires it: one scripted run per main flow, the accounts, the data
before the run, every step with its page, click and typed value, the expected screen, happy and unhappy
cases on prepared data, a fallback per step, a reset procedure and a rehearsal log. Rehearsals are logged
by LongLP (web flows MF-01a to MF-01c, MF-04, MF-05; TK-230) and KhoaDD (device flows MF-02 and MF-03;
TK-231).

Sources, in this order: `docs/demo/2026-11-01-demo-script.md` and `2026-11-01-run-book.md` (the starting
point, re-checked against `dev`); the demo seed `backend/prisma/seed-demo.ts`; the router
`frontend/src/app/router.tsx` and the page components; the backend controllers. A label or screen that was
not found in the code on `dev` is marked **(check by hand)**: the first rehearsal confirms it and corrects
this file.

Passwords, the MQTT node password, Field Station secrets and API keys are never written here. Each one is
"from the team's private channel", or is copied from the screen that shows it once.

**Version 2, 2026-11-26 (leader), for the Faculty Council of Fri 2026-12-04 19:30 (Defense 1.1, Gate 3).**
From now on every rehearsal and the council itself run on the live AWS staging, which is never reseeded
(D-110 rule 10). Sections 1, 2, 3, 11 and 14 describe that environment; section 15 is the run sheet for
the council and section 16 the checklist for the day. Sections 4 to 10 stay the step-by-step reference of
each flow: on the live staging, read every organization, contract, invoice and incident code in them as
"the next code" (section 3) and take the typed values from section 15. The council's rules (co-supervisor
guide, DucDNM's requirement, D-109): every value typed into a form is written here in advance; each flow
shows a happy and an unhappy case; each main flow is rehearsed at least three times with the data reset
between runs (section 11); the data is clean (no test or placeholder rows); the demo covers the main flows
MF-01a to MF-05 in order; about 30 to 35 minutes per group, 5 minutes of slides, then the demo flow by flow.

## 1. Environment and order

### Live staging (from 2026-11-26)

| Item | Value |
|---|---|
| Environment | AWS staging, the web address of the `aws-staging` entry of `deploy/system-endpoints.json` on `main` (D-104); the API is that address plus `/api`, demo sign-in is `/demo`. It ran `dev` at `518a017d` on 2026-11-26; the deploy is frozen from Sat 2026-11-28 (section 16) |
| Database | The staging database is the demo database (D-110 rule 10). No reseed: there is no Neon demo branch and the image has no seed runtime, so the panel's **Reseed the demo database** stays off. Every run adds records, and section 11 closes them through the real screens and the panel |
| Demo panel | `/demo/panel` (section 14), writable on this database. It is a defence aid only (D-110 rule 9): it stays out of the reports, the release notes and the feature slides. This playbook is team-only and uses it |
| Mail | SMTP: every `treklink.dev+...@gmail.com` address lands in the team inbox `treklink.dev@gmail.com` |
| Real units | Five TrekLink v2 units (a274, a278, a294, TL-0001, TL-0002) on RC-2026-0006, LongLP's outdoor rehearsal, report through the Field Station on the device laptop (receiver on COM5). The receiver must itself be a unit the station's organization holds (web#547). Since web#558 (in review on 2026-11-26) the gateway keeps a packet the broker refuses |
| Browser | One browser profile per account (row Browser of the table below) |

### The reseeded rehearsals of 2026-11-21 (kept for the record)

| Item | Value |
|---|---|
| Environment | AWS staging: the web address is the `aws-staging` entry of `deploy/system-endpoints.json` on `main` (D-104). The API is that address plus `/api`, demo sign-in is `/demo` |
| MQTT broker | The Broker URL shown with the Field Station credential (MF-01c step 9); `deploy/aws/RUNBOOK.md` §7 |
| What the host runs | `NODE_ENV=production`, the simulator off, Demo control off (`DEMO_CONTROLS_ENABLED=false`, `deploy/aws/.env.aws.example:14-16`). So `/t/admin/demo` and its quick scenarios are absent. Every step below uses the real screens. Mail is SMTP (`MAIL_TRANSPORT=smtp`, `.env.aws.example:73`): every `treklink.dev+...@gmail.com` address lands in the team inbox `treklink.dev@gmail.com` |
| Database state | Wiped and reseeded on Sat 2026-11-21, and again before each later rehearsal (section 11). Before each flow: the fresh seed (section 2) plus what the earlier flows of the same rehearsal left (section 3) |
| Browser | One browser profile per account: a private window shares nothing with a normal one, but all private windows of one browser share one session, so two InPrivate windows sign in as the last account used (rehearsal 1). Use, for example, Edge for Staff, Edge InPrivate for one account and Chrome for another. The session is held in memory: a reload or a typed URL signs the window out (`frontend/src/entities/session/model.ts`, 2026-11-01 script §1.4). Move with the sidebar and the links. Inside a flow, browser Back steps back one step and keeps the typed values (treklink-web#536, fixed by treklink-web#538 on 2026-11-22) |

Run order, always the same, because each flow uses what the earlier one left:

1. MF-01a onboarding (a new organization: the next ORG code)
2. MF-01b rental request and approval (the next RC code, ORG-0001, five TrekLink v3 units)
3. MF-01c payment and handover (that contract Active). **Write down the contract code, the five asset tags and the handover time.**
4. MF-02 device data through the Field Station bridge (the real units of RC-2026-0006)
5. MF-03 SOS to incident (TL-0010 of RC-2026-0001, or a real unit of RC-2026-0006; both handed over long ago)
6. MF-04 live map and the organization API
7. MF-05 term end to close (the contract MF-01c handed over in step 3, never RC-2026-0006)

**SOS timing rule (D-040, D-111).** An SOS within `gatewaySync.attributionMarginSeconds` (300 s) of a
handover is stored Unattributed and opens an Unrouted incident. After a handover, wait 5 minutes before an
SOS on that contract, or use a unit handed over earlier: RC-2026-0001's TL-0010 (what the MF-03 playback
uses) or a real unit of RC-2026-0006. Since TK-245 the next attributed SOS from the same unit joins an
Unrouted incident and routes it to the organization's primary. No rehearsal sends a live SOS inside the
margin (leader ruling 2026-11-20).

## 2. Accounts and standing records (live staging)

Accounts: the four seeded role accounts (`backend/prisma/seed-demo.ts`), and the Manager each MF-01a run
registers. Passwords: from the team's private channel, never written here. The `/demo` page lists the four
seeded accounts and signs in with one click when `DEMO_TEST_ACCOUNTS_ENABLED` is on; otherwise use
`/sign-in`.

| Window | Role | Name | Email | Lands on |
|---|---|---|---|---|
| A | Org Manager, ORG-0001 | Pham Duc Huy | `treklink.dev+manager@gmail.com` | `/o` |
| B | TrekLink Staff | Le Thi Thu Ha | `treklink.dev+staff@gmail.com` | `/t/map` |
| C | Org Operator, ORG-0001 | Nguyen Thanh Tung | `treklink.dev+operator@gmail.com` | `/o/map` |
| D | Admin | Tran Quoc Bao | `treklink.dev+admin@gmail.com` | `/t/map` |
| E | Not signed in, then the Manager the run registers (section 15, MF-01a values) | per run | per run | `/`, then `/o` |
| T | Terminal on the device laptop | | | |
| P | Demo panel, the panel operator's own device, not projected (section 14) | | | `/demo/panel` |

Standing records on 2026-11-26 (verified on staging by the orchestrator, 12:xx):

| Record | State | Rule |
|---|---|---|
| ORG-0001, Suong Ngan Trekking Co., Ltd. | Active; Manager and Operator are members; roster: Operator primary, Manager backup | Every flow uses it |
| ORG-0002 to ORG-0004 | Organizations of earlier runs; Managers Tran Van Binh (ORG-0002), Tran Ngoc Anh (ORG-0003), Nguyen Van An (ORG-0004) | Leave them |
| RC-2026-0001 (ORG-0001, seed) | Active; TL-0009 and TL-0010 Rented, handed over long ago | MF-03 uses TL-0010; never end it |
| RC-2026-0004 (ORG-0002) | Active; TL-0003 to TL-0006 and TL-0011 Rented | Leave it |
| RC-2026-0006 (ORG-0001) | Active; five real v2 units TL-0001, TL-0002, a274, a278, a294 (LongLP's outdoor rehearsal) | **Never end it. Never run the panel's MF-02 playback while those units send** (section 14) |
| Devices | Available by variant on 2026-11-26 14:2x: v1 0, v2 1, v3 6, v4 3 | MF-01b requests 5 v3 units, so at least 5 v3 Available (section 16) |
| Field Stations of ORG-0001 | `fs-org-0001-1` "Ta Nang basecamp laptop"; `fs-org-0001-2` (named `fs-org-0001-2`); `fs-org-0001-3` "Outdoor test station", the one that works with the real units (receiver a274) | Never revoke `fs-org-0001-3` |
| INC-2026-000001 | Unrouted, old | The MF-03 unhappy case shows it and leaves it as it is |
| Damage rates | ANTENNA_BROKEN 300,000 VND, CASING_CRACKED 400,000 VND (seed); both together, 700,000 VND, exceed the 500,000 VND approval threshold, so MF-05 shows the Admin approval (DS-05b) | MF-05 **(check by hand: still active on staging)** |
| Codes | Contracts continue from about RC-2026-0013, invoices from about INV-2026-000015 | Never hard-code a future code: say "the next RC code" and write it down when the screen shows it |

## 3. What each run adds, and how it is closed

| Flow | Adds | Closed by (section 11) |
|---|---|---|
| MF-01a | One organization (the next ORG code), Active, with its Manager account | Stays: an organization cannot be deleted. Each run uses its own realistic value set (section 15), never a test name |
| MF-01b | One contract of ORG-0001 (the next RC code), five v3 units Reserved | MF-01c hands it over; a request a failed run left is cancelled with the panel action **Cancel stale request** |
| MF-01c | That contract Active, five units Rented, the first invoice paid, a handover note; one Field Station | MF-05 closes the contract; the Field Station is revoked |
| MF-02 | Field events of the reporting units | Stay (history) |
| MF-03 | One incident, Resolved | The panel action **Close (demo time)** closes it |
| MF-04 | One API key, revoked in the unhappy case | Revoked already |
| MF-05 | The closing invoice, paid; the damaged unit in maintenance | The panel action **Complete maintenance**, then an intake check on the device page (section 11) |

After a full run and section 11, the next run starts from the same state: ORG-0001 with the standing
contracts of section 2, at least 5 v3 units Available, no open incident but INC-2026-000001.

---

## 4. MF-01a: organization onboarding

Accounts: E (not signed in, then the Manager of the run), B Staff, D Admin. Data before: the team inbox
reachable on a phone. On the live staging the values below were used up by the rehearsals of 2026-11-21
(the tax code is taken): type the value set of the run from section 15, and read ORG-0002 as the next ORG
code.

Prepared values: Registered company name **Phan Dung Trekking Co., Ltd.**; Tax code **0312345678**;
Registered address **18 Tran Hung Dao, Bao Loc, Lam Dong**; Company phone **0263 3821 456**; Manager full
name **Tran Van Binh**; Manager email **treklink.dev+register@gmail.com**; Manager phone **0905 123 456**
(phones match `^\+?[0-9 ]{8,15}$`, `backend/src/modules/organizations/dto/onboarding.dto.ts:18`); Master
contract number **MC-2026-0002**; new password: from the team's private channel.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | E, `/` | **Register your organization** | | "Register your organization" with seven fields (`RegisterPage.tsx`) | Open `/register` from the sign-in page link |
| 2 | E, `/register` | Fill the seven fields, **Register** | the prepared values above | "Registration received..." and "Your organization code is **ORG-0002**. The Manager receives an email to set a password." | If refused as already registered, the database was not reset: section 11 |
| 3 | B, `/t/organizations` | Tab **Pending**, row **ORG-0002** | | Detail with the code, tax code, address and the "Counter verification" form | Search "0312345678" in **Search by code, name or tax code** |
| 4 | B | Counter verification: Method **In person**, tick **Business registration** and **Manager ID card**, Master contract number, tick both master contract boxes, **Record verification** | MC-2026-0002 | Toast "Saved."; the detail shows "Verified ..., in person, contract MC-2026-0002"; Staff see no Approve | Repeat the step; the button then reads **Update verification** |
| 5 | D, `/t/organizations` | Tab **Pending**, **ORG-0002**, **Approve** in the action bar at the bottom | | Toast "ORG-0002 approved. The Manager can now request devices." (`OrganizationReviewPage.tsx:460`) | If **Approve** is disabled, step 4 was not saved: redo it as Staff |
| 6 | Phone, team inbox | Open the mail "Your TrekLink invitation code" to `treklink.dev+register@gmail.com`, note the code | | "Your TrekLink invitation code is <code>. It is valid for 72 hours..." **(check by hand: SMTP delivery on AWS)** | Spam folder; if absent after 2 minutes, Admin resends the invitation from `/t/admin/accounts` **(check by hand)** |
| 7 | E, `/sign-in` | **Set password** | | `/welcome`, fields Email, Invitation code, Password, Confirm password | Open `/welcome` from the sign-in page again |
| 8 | E, `/welcome` | Fill, **Set password and sign in** | `treklink.dev+register@gmail.com`, the code, the password twice | Signed in as Tran Van Binh on `/o`, ORG-0002 overview | A wrong code shows an error under the field: retype it from the mail |

### Unhappy case: duplicate registration

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | New private window, `/register` | Fill and **Register** | same values as step 2, Manager email **treklink.dev+register2@gmail.com** | Refused: "This tax code is already registered." (409, `organization-onboarding.service.ts:97-103`); no ORG-0003 | If it is accepted, stop and record a defect; reject the extra organization as Admin with reason "Duplicate registration of ORG-0002" |

---

## 5. MF-01b: rental request and approval

Accounts: A Manager (Pham Duc Huy), B Staff. Data before: after MF-01a; at least 5 v3 units Available
(6 on 2026-11-26 14:2x, section 2). The request is the run's contract: write its code down at step 4.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | A, `/o` | **Request a contract** | | `/o/contracts/new`, steps Plan and devices, Start date, Review and send | Sidebar **Contracts**, **Request a contract** |
| 2 | A | Plan **Monthly**; variant card **TrekLink v3 (GPS, SOS button)**; Quantity; **Next** | 5 | "6 available now" under Quantity on 2026-11-26 **(check by hand: the count)**; Quote "Term fee (one month) 2,250,000 VND", "First payment, holding fee (50 %) 1,125,000 VND" | If the count is under 5, a hold is left from an earlier run: section 11 |
| 3 | A | Start date: today, **Next** | today's date | Today is the earliest date offered |  Today not offered: check the laptop clock and time zone (Asia/Ho_Chi_Minh), sign in again as A and start again at step 1; nothing is saved before step 4 |
| 4 | A | **Send request** | | "Request RC-2026-00xx sent" (the run's contract: write the code down), five devices held for 24 hours, "Deposit due before then: 1,125,000 VND" with **Open the contract** and **Pay the deposit** | If the toast shows a server error, open **Contracts**: the request may exist; do not send twice |
| 5 | B, `/t/contracts` | **Show** menu **Requested**; the run's contract, **Show details** | | Details pane with plan, devices, prices and the hold line | Search the run's contract code |
| 6 | B | Handover appointment: a time later today; **Approve** | the next full hour | Toast "<the run's contract> approved. 5 devices reserved." (`ContractApprovalPage.tsx:197`) and the reserved tags: write them down | A past time is refused: "The handover appointment is in the past...": pick a later time |

### Unhappy case: below the minimum order

Run before step 2. With 6 v3 units Available, a second request of five (the 2026-11-21 rejected-request
case) cannot be held, so the live staging shows the minimum order instead (`rentals.minOrderQuantity`, 5).

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | A, `/o/contracts/new` | Plan **Monthly**; variant card **TrekLink v3 (GPS, SOS button)**; Quantity; **Next** | 4 | "The minimum order is 5 devices." under Quantity; the page stays on the first step and nothing is sent | Go on with step 2, Quantity 5 |

---

## 6. MF-01c: payment and handover

Accounts: B Staff, A Manager (signs on the Staff screen). Data before: the run's contract (MF-01b) Approved
with five v3 units Reserved. Run on the start date; the appointment time does not hold the handover up (the handover
checks only the start date, `backend/src/modules/rentals/handover.service.ts`).

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | B, `/t/contracts/<id>` | From step 6 of MF-01b, **Open the contract**, **Start handover** | | Handover mode with steps Devices, Payment, Preview note, Sign | **More actions**, **Open the counter** (`/t/counter/<contractId>`) |
| 2 | B, Devices | **Scan or type an asset tag**, **Find** | first reserved tag written down at MF-01b step 6 | Row highlighted, "<tag> is on this contract." | Type the tag again without spaces |
| 3 | B | Tick **Select all units**; **Battery % for selected**; **GPS fix for selected** GPS fix; **Set readings for selected** | 90 | "Readings set on 5 units." every row 90 and GPS fix | Set the readings on each row |
| 4 | B | **Record provisioning for selected**, then **Next** | | "Recorded 5 of 5." each row "Provisioned v1" | A wrong unit: its row **Undo**, then **Undo provisioning**, record again |
| 5 | B, Payment | **Record a counter payment**; Method Cash; **Receipt number**; **Record** | Amount received 1125000; receipt CT-2026-0418 | Toast "Payment of 1,125,000 VND received." Before 09:00 local, Due now reads 0 VND and the prefill is 2,250,000: type 1125000 (2026-11-01 script MF-01 step 9) | Record the payment from `/t/billing` on the contract's first invoice |
| 6 | B, Preview note | **Next** | | The unsigned note, marked as a preview, with battery 90 % and Fix OK | **Open the preview in a new tab** |
| 7 | B with A, Sign | **Signing Manager** Pham Duc Huy; **Identity document checked**; the Manager signs; **Complete handover** | CCCD ending 1234 | Toast "Handover complete. 5 devices issued under contract <the run's contract>."; Active. **Write down the time** | Signature lost: clear the box and sign again |
| 8 | B | Tab **Documents**, **Download handover note** | | `<the run's contract>-handover-note.pdf`, two pages, letterhead and both signatures | Show the note from the contract later |
| 9 | A, `/o/field-stations` | **Create Field Station**, Name, **Create** | the run's Field Station name (section 15.1) | "Credential for <name>": Broker URL, Username, the next `fs-org-0001-` username (`fs-org-0001-1` to `-3` exist) **(check by hand: the number)**, Secret, "Copy it now; it will not be shown again." Do not copy it: the device laptop keeps `fs-org-0001-3` "Outdoor test station"; section 11 revokes the run's station | Skip and say it |

### Unhappy case: unit below the minimum battery

Run between steps 3 and 7.

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | B, Devices | On one row set Battery % | 35 | Accepted on the row |  Value refused ("Enter the battery as a whole number from 0 to 100."): type 35 again |
| U2 | B, Sign | **Complete handover** | | Refused: "Battery below 50 % on TL-00xx. Charge before use, or acknowledge." (`handover.service.ts:582`, `devices.handoverMinBatteryPct`), shown as an amber banner under the signature box with the link **Proceed anyway** to acknowledge (rehearsal 2, 2026-11-27) | Go back to Devices, set the row to 90, continue at step 7 |

### Unhappy case: duplicate payment webhook (optional)

Only if the SePay sandbox is set up on AWS **(check by hand)**. As A, on the run's contract use **Pay the
deposit** before step 5 instead of a counter payment, pay from the sandbox, then send the same transaction
again from the SePay sandbox. Expected: the payment page shows the payment confirmed once; the second
delivery is answered as a duplicate and records nothing (`backend/src/modules/billing/sepay.service.ts:247`).
Fallback: record the deposit at the counter (step 5).

---

## 7. MF-02: device data through the Field Station bridge

Accounts: T (the device operator), C Operator, B Staff. Data before: after MF-01c; the gateway runs on the
device laptop as Field Station `fs-org-0001-3` "Outdoor test station".

The device flows MF-02 and MF-03 run on the real units of RC-2026-0006 (ORG-0001): TL-0001, TL-0002, a274,
a278 and a294, registered with their real node ids and handed over long ago. They report through
`fs-org-0001-3` with a274 as the receiver on COM5; the receiver must itself be a unit ORG-0001 holds
(web#547). The seed units TL-0009 and TL-0010 of RC-2026-0001 carry placeholder node ids
(`seed-demo.ts:252-256`) and stay as the fallback. Where a step below names TL-0009 or TL-0010, read the
real units; the expected screens then show their asset tags and holders.

Gateway environment on the device laptop, set before the run (names only): `MQTT_BROKER_URL` = the AWS
broker URL, `GATEWAY_FS_USERNAME=fs-org-0001-3`, `GATEWAY_FS_SECRET` from the team's private channel,
`GATEWAY_SERIAL_SIMULATION=false`, `GATEWAY_SERIAL_PORT=COM5`, the port of the receiver a274
(`gateway/src/config.ts:137-144`). Not the credential of MF-01c step 9.

**Fallback, disclosed as simulated.** If the physical units cannot report, restart the gateway in its demo
mode for the seed nodes (`gateway/src/config.ts:140-170`) and say aloud that the data is simulated:
`GATEWAY_SERIAL_SIMULATION=true`, `GATEWAY_SIM_NODES=!de000009,!de00000a`, `GATEWAY_SIM_SOS_EVERY=0` (no SOS
during MF-02; the default 12 sends one every twelfth tick), `GATEWAY_SIM_INTERVAL_MS=30000`.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | T | `npm run dev:gateway` from the repository root | the variables above | Gateway lines: connected to the broker, the serial port open, packets from the physical units as they report **(check by hand: log wording)** | Wrong secret: the broker refuses; recheck the copy. Units silent or port not found: the simulated fallback above, then section 11 step 3 |
| 2 | Talk | Path: node, LoRa, laptop over USB, SQLite queue (SOS first), MQTT QoS 1, backend ingest with `eventId` dedup | | |  None, observe only |
| 3 | C, `/o/map` | **Live map** | | The physical units (fallback: TL-0009 and TL-0010) with battery and a recent last-seen time | Wait for the next report; then check step 4 |
| 4 | B, `/t/admin/sync` | Sidebar **Field data sync** | | MQTT subscriber up; Field Stations table: "Outdoor test station", Connected, a Last sync; Recent field events for the physical units (fallback: TL-0009 and TL-0010), Attribution "Attributed" | If the station reads "Never reported", the health report waits up to 60 s (`GATEWAY_HEALTH_INTERVAL_MS`); refresh |

### Unhappy case: duplicate packet

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | T | Publish the recorded position fixture twice with the same id: `npm --prefix backend run replay:mqtt -- position --times 2` with `MQTT_BROKER_URL`, `MQTT_USERNAME=node-!de000009`, `MQTT_PASSWORD` from the team's private channel **(check by hand: the fixture's node and the broker's per-node topic rule)** | | | If the broker refuses the login, skip U1 and say so |
| U2 | B, `/t/admin/sync` | Refresh | | **Duplicates rejected** grows by one; the audit lists "Duplicate rejected" (`SyncStatusPage.tsx:46, 254`) **(check by hand: the fixture time is old, use the audit list)** |  Count unchanged: show the newest row of the Sync audit list, **Show** menu Every outcome; if no duplicate row, say so and repeat U1 once |

---

## 8. MF-03: SOS to incident

Accounts: C Operator (primary), A Manager (backup), B Staff. Data before: after MF-02, gateway running.
**Start no earlier than the MF-01c handover time plus 5 minutes (D-111), and no earlier than 5 minutes after
the handover of the physical unit used.** TL-0010 was handed over by the seed, so its SOS is attributed to
RC-2026-0001 and routed to the Operator. The steps name TL-0010; with a physical unit, read its asset tag
and holder.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | Physical unit | Press the unit's SOS control once (on a v3, hold the user button 3 s, `seed-demo.ts:203`) **(check by hand: the variant of the leader's unit)** | | The gateway log shows the SOS queued first | Disclosed as simulated: `npm --prefix backend run replay:mqtt -- sos --now --new-ids` with `MQTT_USERNAME=node-!de00000a` (TL-0010) |
| 2 | C, any page | | | Red banner "SOS: TL-0010 (Dang Quoc Viet), hh:mm. Acknowledge now." with **Acknowledge** (`AlertBanner.tsx`) | No banner in 10 s: `/o/incidents`; if the incident is Unrouted, the SOS was inside the margin: go to the unhappy case and say so |
| 3 | C, `/o/incidents` | Open the new incident (the run's incident: write its code down) | | Device TL-0010, state Notifying primary, last coordinates |  Not in the list: open **Incidents** again from the sidebar; still absent, sign in again as C |
| 4 | C | **Acknowledge** | | Toast "Saved."; Owner Nguyen Thanh Tung, Acknowledged; banner gone |  "Someone else changed this. Reload to see the latest.": sign in again as C, open the incident, **Acknowledge** again |
| 5 | C | **Response under way**, What is being done, **Save response** | Ranger team dispatched from the Ta Nang post | State Responding |  Save refused: retype the prepared value; a stale-version message: sign in again as C and repeat the step |
| 6 | C | **Add status**, a line, save | Team at km 6, voice contact with the hiker | The update with author and time |  Save refused: retype the prepared value; a stale-version message: sign in again as C and repeat the step |
| 7 | C | **Report outcome**, Outcome, **Resolve incident** | Hiker found, minor ankle injury, walked out | State Resolved; History lists each step |  Save refused: retype the prepared value; a stale-version message: sign in again as C and repeat the step |

### Unhappy case: SOS without attribution (Unrouted)

The rule forbids a live SOS inside the margin, so the old INC-2026-000001 on TL-0001 stands in: it was
opened while TL-0001 was in no custody, the same Unrouted path an early SOS takes (leader ruling
2026-11-20: no live SOS inside the margin). TL-0001 is now a real unit of RC-2026-0006, and since TK-245
the next attributed SOS from TL-0001 would join INC-2026-000001 and route it to ORG-0001's primary, so
**MF-03 never sends its SOS from TL-0001**. On the live staging run U1 only and leave the incident
Unrouted for the next run: U2 and U3 change it for good, so they run only when the leader retires it.

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | B, `/t/incidents` | **Show** menu **Unrouted**; row TL-0001, **Show details** | | Owner "TrekLink Staff queue", state Unrouted | Search "INC-2026-000001" |
| U2 | B (only when the leader retires INC-2026-000001) | **Report to authorities**; Agency; Authority reference; Reported at as prefilled; **Record report** | Lam Dong Provincial Police; LD-2026-1121 | Toast "Saved."; "Reported to authority" | A future time is refused: keep the prefilled time |
| U3 | B | Tab **Authority reports**, **Record case closed** on the row, confirm | | Toast "Saved."; the case reads closed |  A Closed at before the report time is refused: keep the prefilled time; row not shown: **Show** menu All reports |

---

## 9. MF-04: live map and the organization API

Accounts: C Operator, B Staff, A Manager, T for `curl`. Data before: after MF-03, gateway running.

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | C, `/o/map` | **Live map** | | Header with device and SOS counts; TL-0009 and TL-0010 (RC-2026-0001), TL-0001, TL-0002, a274, a278 and a294 (RC-2026-0006) and the five units of the run's contract ("not heard since handover"); not RC-2026-0004, which is ORG-0002's |  Units missing: show the same units on the Staff **Fleet map** (step 4); then sign in again as C |
| 2 | C | **Search asset tag, holder or contract** | TL-0010 | One row, battery, holder, last seen | Clear the search |
| 3 | C | Zoom out to 6 or 7, drag left | | "Quần đảo Hoàng Sa (Việt Nam)" and "Quần đảo Trường Sa (Việt Nam)" on their masks (D-031) | Tiles slow: wait; the masks draw without tiles |
| 4 | B, `/t/map` | **Fleet map**, organization filter ORG-0001 | | Every organization's units, then ORG-0001 only |  Filter empty: choose All organizations, then ORG-0001 again; or show the Operator's Live map of step 1 |
| 5 | A, `/o/api-keys` | **Create API key**, Name, create | the run's API key name (section 15.1) | The key once with **Copy** and "Copy it now; it will not be shown again."; copy it to T privately | Lost key: revoke it, create another |
| 6 | T | `curl -s -H "X-Api-Key: <key>" <staging address>/api/telemetry/devices` | | 200, `{ result, isSuccess, statusCode, message }`, `result.devices` with ORG-0001's units (`org-api.controller.ts:96`) | Show the Live map instead and say the API answered in rehearsal |

### Unhappy case: revoked API key

API keys carry no expiry on `dev` (`ApiKeysPage.tsx` shows Active or Revoked only), so a revoked key stands in for an expired one.

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | A, `/o/api-keys` | The run's key, **Revoke**, confirm | | Toast "API key revoked"; status Revoked |  Row still Active: sign in again as A and **Revoke** it again from **API keys** |
| U2 | T | The `curl` of step 6 again | same key | 401, `isSuccess` false, "Authentication required." (`backend/src/modules/auth/guards/api-key.guard.ts:40-45`) |  200 returned: check the key is the one copied in step 5 and its row reads Revoked, then repeat the call |

---

## 10. MF-05: term end to close

Accounts: A Manager, B Staff, D Admin (step 8a). On the live staging RC-2026-0002 is closed: MF-05 ends the contract MF-01c
handed over (five units, section 15), never RC-2026-0006, and the steps below read that contract and its
five tags for RC-2026-0002, TL-0017 and TL-0018. Data before (rehearsals of 2026-11-21): RC-2026-0002
Active, TL-0017 and TL-0018 Rented, first invoice
paid. Its term ends a month after the seed, so on stage the term end is **End contract now** (D-097), the
real Staff and Manager action (leader ruling 2026-11-20).

### Happy run with the unhappy case (damaged return)

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | A, `/o/contracts` | RC-2026-0002, **Give notice**, confirm **Give notice** | | Toast "Notice recorded. The contract ends on <term end>..."; badge Ending | If **Pay invoice** is primary, use **More actions**, **Give notice** |
| 2 | A | **More actions**, **End contract now**; Reason; confirm | The trek season of Suong Ngan Trekking ended early | Dialog "End RC-2026-0002 now?" with Credit and After it; toast "Contract ended. Check the units in at the counter." Status Return due (rehearsal 3, 2026-11-28) | Staff can run the same action from the contract home |
| 3 | B, `/t/contracts` | **Show** menu All; RC-2026-0002, **Open the contract**, **Record return** | | Counter "Counter: RC-2026-0002", tabs Check-in, Reset and inspection, Close | **More actions**, **Open the counter** |
| 4 | B, Check-in | **Scan or type an asset tag**, add, check in | TL-0017, then TL-0018 | "Check-in complete. 2 of 2 devices returned." **(check by hand: wording for two)** | Add the tags one at a time |
| 5 | B, Reset and inspection | **Record reset** on both, tick the steps | | Rows "Reset logged" |  Reset not recorded: tick every step and **Record reset** again; a sign-in again keeps a recorded reset (it is stored on the contract) |
| 6 | B | TL-0017: **Inspect**, Passed, **Record inspection** | | TL-0017 Available |  **Inspect** not offered: record the reset of step 5 first, then inspect |
| 7 | B | TL-0018: **Inspect**, **Damaged**, tick Antenna broken (ANTENNA_BROKEN) and Casing cracked (CASING_CRACKED), **Record inspection** | | "Damaged, maintenance", "Damage 700,000 VND, waiting for an Admin" (300,000 plus 400,000 VND is above the 500,000 VND approval threshold, `billing.damageApprovalThresholdVnd`, so the charge waits for an Admin other than the inspector, BR-24, DS-05b) (rehearsal 3, 2026-11-28) |  Casing cracked not listed: sign in again as B, open the counter with **More actions**, **Open the counter**, inspect again |
| 8 | B, Close | Tab **Close** | | Blocker "The damage charge of 700,000 VND on TL-0018 waits for an Admin." (`return.service.ts:369`); no Close action yet |  No blocker shown: switch to another tab and back (the close check reloads on focus); if **Close contract** is offered and **Money** reads "TrekLink owes ... VND", go to step 9b; otherwise go to step 10 and say nothing was due |
| 8a | D, `/t/damage-charges` | **Show** menu Waiting for an Admin; the TL-0018 row, **Decide**; Decision **Approve**; Reason; **Record decision** | Antenna and casing damage confirmed at the counter | Dialog "Decide the charge on TL-0018" with "ANTENNA_BROKEN, CASING_CRACKED: 700,000 VND"; toast "Saved."; status Approved (rehearsal 3, 2026-11-28) | **Decide** disabled with "Another Admin must decide: you inspected this device.": the signed-in Admin inspected the unit; inspect as B Staff, never as D |
| 8b | B, Close | Tab **Close** again | | Blocker "... unpaid on the contract's invoices." with **Open the invoices**; no Close action yet | No blocker shown: switch to another tab and back (the close check reloads on focus); if **Close contract** is offered and **Money** reads "TrekLink owes ... VND", go to step 9b; otherwise go to step 10 and say nothing was due |
| 9 | B | **Open the invoices**, the Closing invoice, **Record counter payment**, Method Cash, receipt, **Record** | the prefilled amount; receipt CT-2026-0419 | Toast "Payment of <amount> VND received." (amount = 700,000 VND less any end-now credit) **(check by hand)** | `/t/billing`, filter the contract |
| 9b | B | When step 8b shows no blocker and **Money** reads "TrekLink owes ... VND" (the end-now credit exceeds the damage, rehearsal 1): the Closing invoice row, **Actions**, **Mark refunded**, **Mark refunded** in the dialog | Note: CT-2026-0419 | The invoice shows "Refunded to organization" with the amount, the time and the note CT-2026-0419 | Open the Closing invoice from `/t/billing` and press **Mark refunded** there |
| 10 | B | Counter tab Close, **Close contract**, confirm | | Toast "RC-2026-0002 closed."; badge Closed | If a blocker remains, read it and resolve it; the close check reloads on focus |

---

## 11. Reset between runs (live staging, panel-based)

There is no reseed (D-110 rule 10). A run is reset by closing what it opened, through the real screens and
the demo panel, so the next run starts from section 3's state. Run this after every rehearsal of a flow and
after the council. Allow 10 minutes. The leader or the panel operator does it; nobody else rehearses while
it runs.

1. **The contract.** MF-05 by hand closes what MF-01c opened. If the run stopped before MF-05, the panel
   playback **MF-05** ends it: it takes the contract the last MF-01c playback handed over while it is still
   Active, else the newest Active contract of ORG-0001, never one holding a unit heard from a real node in
   the last 7 days (so never RC-2026-0006), returns every unit with a Passed inspection and closes the
   contract after paying what is due. Before you press **Start**, read the contract codes on the panel: the
   newest Active ORG-0001 contract must be the run's contract. A request that never reached handover:
   panel action **Cancel stale request** on it (Contracts, choose the contract), which releases its units.
2. **The damaged unit.** MF-05 by hand sends one unit to maintenance (CASING_CRACKED). Panel action
   **Complete maintenance** on that unit (Devices, choose it). Then as B Staff open the unit's device page,
   **Record intake check**, leave GPS fix, Radio and Battery on, **Save**: the unit reads Available.
3. **The incident.** MF-03 leaves its incident Resolved. Panel action **Close (demo time)** on it
   (Incidents, choose it): Closed. Leave INC-2026-000001 Unrouted (the MF-03 unhappy case shows it). The
   DS-03b incident on TL-0009 (section 15.6) is left Escalated: panel actions **Acknowledge**, then **False
   alarm**, then **Close (demo time)** on it; Escalated allows no False alarm directly
   (`incident-lifecycle.ts:88-95`).
4. **The Field Station** created in MF-01c: as A, `/o/field-stations`, the run's station, **Revoke**,
   confirm. Never revoke the station of the device laptop.
5. **The API key** of MF-04 is revoked in its unhappy case; check `/o/api-keys` shows no Active key of the run.
6. **Unpaid invoices** a stopped run left: panel action **Pay at the counter** on each (Billing, choose the
   invoice).
7. **Check.** On the panel: at least 5 TrekLink v3 units read Available, no contract of the run is Active,
   no incident but INC-2026-000001 is open. `GET <staging>/api/health` shows `"database":"up"` and
   `"mqtt":"up"`. RC-2026-0001 and RC-2026-0006 are still Active.
8. **The organization** a run registered stays (section 3); the next run uses the next value set of section 15.

Fallbacks: a panel action refused as stale ("Reload and try again"): the panel re-reads its lists, choose the
record again. The gateway of the device laptop keeps running between runs; stop it only after the council.

---

## 12. Rehearsal log

Result: Pass, Pass with fallback (name the step), or Fail (name the step). Notes: every screen that
differed from this file, then correct the file.

### MF-01a (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with fallback (step 8) | Step 8: the first **Set password and sign in** answered "Internal server error" (about 17:38); the second press signed in (treklink-web#533). U1 refused as written |
| 2026-11-27 | LongLP (rehearsal 2, set R2) | AWS staging, live database, no reseed | Pass | ORG-0005 Bidoup Ridge Adventures Co., Ltd. registered 17:22; U1 refused "This tax code is already registered."; B verified 17:24 (MC-2026-0102) with no Approve offered; D approved "ORG-0005 approved. The Manager can now request devices."; the Manager set the password and signed in |
| 2026-11-28 | LongLP (rehearsal 3, set R3) | AWS staging, live database, no reseed | Pass | ORG-0006 Ta Nung Valley Expeditions Co., Ltd. registered 11:12; U1 refused the second registration of the tax code; B verified (MC-2026-0103) with no Approve offered; D approved "ORG-0006 approved. The Manager can now request devices."; the Manager password step (step 6) was left to LongLP from the invitation email |

### MF-01b (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with deviation (step 4) | RC-2026-0004 was sent from Tran Van Binh (ORG-0002), not window A: two Edge InPrivate windows share one session. Run each account in its own browser profile |
| 2026-11-27 | LongLP (rehearsal 2) | AWS staging, live database | Pass | Quantity 4 refused "The minimum order is 5 devices."; RC-2026-0013 sent 17:26, five v3 held to 28 Nov 17:26; B approved with the appointment 18:00, "RC-2026-0013 approved. 5 devices reserved.", TL-0012 to TL-0016. Browser Back on step 3 returned to step 2 with the start date kept (treklink-web#536 fixed) |
| 2026-11-28 | LongLP (rehearsal 3) | AWS staging, live database | Pass | Quantity 4 refused; "5 available now"; RC-2026-0014 sent about 15:15, five v3 held to 29 Nov 15:15; B approved with the appointment 16:00, "RC-2026-0014 approved. 5 devices reserved.", TL-0012 to TL-0015 and TL-0017 |

### MF-01c (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with deviation (step 7) | RC-2026-0004 belonged to ORG-0002, so the only signer offered was Tran Van Binh; handed over 18:19. Battery unhappy case not run in this run |
| 2026-11-27 | LongLP (rehearsal 2) | AWS staging, live database | Pass | "Readings set on 5 units."; "Recorded 5 of 5."; Cash 1,125,000 VND, CT-2026-1102, "Payment of 1,125,000 VND received."; TL-0016 at 35 % refused at Sign (amber banner, **Proceed anyway**), set back to 90; signed by Pham Duc Huy, "Handover complete. 5 devices issued under contract RC-2026-0013.", handed over 17:31; Field Station "Bidoup ranger post" credential shown once, `fs-org-0001-4` |
| 2026-11-28 | LongLP (rehearsal 3) | AWS staging, live database | Pass | "Readings set on 5 units."; "Recorded 5 of 5."; Cash 1,125,000 VND, CT-2026-1103, "Payment of 1,125,000 VND received."; TL-0017 at 35 % refused at Sign ("Battery below 50 % on TL-0017...", amber banner, **Proceed anyway**), set back to 90; handed over 15:19; Field Station "Ta Nung ranger post" credential shown once, `fs-org-0001-5` |

### MF-02 (KhoaDD, TK-231)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-25 | LongLP | AWS staging, no reseed since 2026-11-21; outdoor run with real v2 units on RC-2026-0006 | Pass with fallback (step 1) | Station `fs-org-0001-3`. With a264 as receiver every packet was refused, because a264 was not rented to ORG-0001 (treklink-web#547); with a274 as receiver, 35 events 15:50 to 16:11, all Attributed. Duplicate case not run |
| | | | | |
| | | | | |

### MF-03 (KhoaDD, TK-231)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-25 | LongLP | AWS staging, outdoor run with real v2 units on RC-2026-0006 | Fail (step 1) | No SOS incident was created during the run; only the seeded INC-2026-000001 exists |
| | | | | |
| | | | | |

### MF-04 (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass | Step 1 lists no RC-2026-0004 units (that contract was ORG-0002 in this run). Step 6: 200 with five units, all NOT_HEARD (MF-02 not run); U2: 401 after the revoke |
| 2026-11-25 | LongLP | AWS staging, outdoor run with real v2 units on RC-2026-0006 | Pass with deviation (step 3) | Live map showed a274 (position 15:52) and a294 (first position on the wire, 16:07, treklink-firmware#38); movement between two points not shown; a278 got no GPS lock. API key steps not rerun |
| 2026-11-27 | LongLP (rehearsal 2) | AWS staging, live database | Pass with deviation (step 1) | Run as A: the `/demo` page offers no Operator account. Live map 13 devices with both sovereignty labels; search TL-0010 left one row; key "Bidoup ranger dashboard" `tlk_61Vi`: `curl` 200, revoked 17:44, `curl` 401. The key row still read Last used "Never" after the 200 |
| 2026-11-28 | LongLP (rehearsal 3) | AWS staging, live database | Pass with deviation (step 1, U2) | Run as A: the `/demo` page offers no Operator account. Live map 13 devices with both sovereignty labels; search TL-0010 left one row; key `tlk_Yd0y`: `curl` 200 (run by LongLP), revoked 17:23; the `curl` after the revoke (U2) was not recorded. The key row read Last used "Never" after the 200, as in rehearsal 2 |

### MF-05 (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with fallback (step 2) | Step 2: End now answered "Internal server error" (about 18:36) yet the contract ended (closing invoice issued 18:36); pressed once (treklink-web#535). Steps 8 and 9: the end-now credit exceeded the damage, so nothing was due and TrekLink owed 470,000 VND; refund recorded on the closing invoice (CT-2026-0419). Closed 18:43 |
| 2026-11-27 | LongLP (rehearsal 2) | AWS staging, live database | Pass with deviation (step 7) | Notice "Notice recorded. The contract ends on 27 Dec 2026..."; End now credit 2,175,000 VND for 29 days, "Contract ended. Check the units in at the counter." with no error (treklink-web#535 fixed); check-in 5 of 5; reset five; TL-0012 to TL-0015 Passed; TL-0016 Damaged with Casing cracked only, 400,000 VND, run before the two-code and Admin-approval steps were added, so 8a not run; TrekLink owed 650,000 VND, **Mark refunded** with Note CT-2026-1112; "RC-2026-0013 closed." 17:50. Section 11 left to the leader: TL-0016 in maintenance, station `fs-org-0001-4` to revoke |
| 2026-11-28 | LongLP (rehearsal 3) | AWS staging, live database | Pass (steps 8b to 9b) | First run with the two damage codes and the Admin decision. Notice recorded; End now 17:24, credit 2,175,000 VND for 29 days, "Contract ended. Check the units in at the counter." with no error; check-in 5 of 5; reset five; TL-0012 to TL-0015 Passed; TL-0017 Damaged with Antenna broken and Casing cracked, "Damage 700,000 VND, waiting for an Admin"; step 8 blocker "The damage charge of 700,000 VND on TL-0017 waits for an Admin."; 8a as D: dialog "Decide the charge on TL-0017" with "ANTENNA_BROKEN, CASING_CRACKED: 700,000 VND", Approve, "Saved.", Approved; 8b no blocker, Money "TrekLink owes Suong Ngan Trekking Co., Ltd. 350,000 VND", so 9b: **Mark refunded** with Note CT-2026-1113, INV-2026-000023 "Refunded to organization: 350,000 VND"; Closed 17:32 (the badge changed a few seconds after the close answered 200). The approved rows of TL-0016 and TL-0018 on `/t/damage-charges` still read "Another Admin must decide: you inspected this device." for D, whose account inspected neither. Section 11 left to the leader: TL-0017 in maintenance, station `fs-org-0001-5` to revoke |

## 13. Differences from the 2026-11-01 script

- Its W43 start lines use Demo control (`/t/admin/demo`) and Quick scenarios; AWS staging runs with
  `DEMO_CONTROLS_ENABLED=false`, so those pages are absent there.
- Its MF-01a step 6 reads the invitation code from the console mail log; AWS sends SMTP mail to the team inbox.
- Its MF-02 runs the gateway against a local broker with no credential; AWS needs the Field Station
  credential and TLS. Its seeded station `fs-org-0001-1` has no usable secret on a fresh seed.
- Its MF-05 step 2 moves the term end with a terminal script; on stage the term end is End contract now (leader ruling 2026-11-20).
- Its MF-01 step 2 card count ("8 available") and step 2a ("Only 10 ...") disagree with each other; a fresh
  seed has 10 v3 units Available.

## 14. Demo panel (D-110, TK-243)

`/demo/panel`, behind its own password (`docs/demo/2026-11-24-demo-panel-security.md`). A defence aid only
(D-110 rule 9): it stays out of the reports, the release notes and the feature slides. Its three views are
**Panel operator**, **Presenter** and **Site clicker**.

- **Rule 10: the staging database is the demo database.** The panel writes to the live staging; the reseed
  is off and stays off. Every press is a real record, audited as `demo.panel.*`. Section 11 resets a run.
- **Who and where.** The panel operator opens `/demo/panel` on a device of their own, in a window that is
  not projected, signs in with the password from the leader (**Open the panel**) and stays on **Panel
  operator**. The presenter may follow the **Presenter** view on a second device.
- **Use a separate connection.** A phone hotspot, never the venue Wi-Fi. The panel counts wrong passwords per
  client address: five wrong guesses within ten minutes from the shared venue address would lock the
  operator out until that ten-minute window ends.
- **Playbacks** (Main flow playback: choose the flow, Seconds between steps, **Start**; **Pause**,
  **Resume**, **Next step**, **Stop**). Each executed step is one panel command, the same state the real
  screens produce.

  | Flow | What the playback does | Caution |
  |---|---|---|
  | MF-01a | Registers an organization with its own run names and a tax code starting with 8, records Staff's counter verification, then **pauses** at the Admin approval | **The panel never acts as the Admin.** It waits with "Approve ORG-.... on the Admin screen": the site clicker approves in window D (section 4 step 5) and the playback runs on by itself once the organization is Active (D-110 rule 8); otherwise press **Resume** |
  | MF-01b | Requests a contract for ORG-0001 (TrekLink v3, the minimum order quantity, today) and approves it | Needs 5 v3 units Available |
  | MF-01c | Pays the holding fee at the counter and hands the approved ORG-0001 contract over | MF-05 later ends this contract first |
  | MF-02 | Narrates the data path, then sends one **simulated** position for every rented ORG-0001 unit with a node number | **Never while the RC-2026-0006 units send**: it would mix simulated positions into their real track. Say aloud that the data is simulated |
  | MF-03 | Sends a **simulated** SOS from TL-0010, then acknowledges, responds and resolves as the Operator | TL-0010 was handed over long ago, so the 5-minute rule (section 1) holds |
  | MF-04 | Narration only | |
  | MF-05 | Ends the contract the last MF-01c playback handed over while it is Active, else the newest Active ORG-0001 contract, never one with real-node data in the last 7 days; returns every unit Passed; pays and closes | Shows no damaged unit: the damaged case is by hand |

- **Actions** (one button each, grouped Incidents, Contracts, Billing, Devices): Send SOS, Acknowledge,
  Response under way, Resolve, False alarm, Close (demo time); Request a contract, Approve, Hand over,
  Return all units, Close, Cancel stale request; Pay at the counter; Send to maintenance, Complete
  maintenance. **Send SOS** needs a rented unit in live custody (**Rented unit for an SOS**).
- **The 5-minute rule.** Never **Send SOS** on a unit of a contract handed over less than 5 minutes ago: the
  SOS would be Unattributed and its incident Unrouted (D-040).
- After the defence the leader rotates the password (security note §5).

## 15. Run sheet for the Faculty Council, Fri 2026-12-04 19:30

About 30 to 35 minutes for the group: 5 minutes of slides, then 29 minutes of demo (0:00 to 29:00), flow
by flow in the order of section 1, then questions. Each flow shows its happy case and one unhappy case. The
panel is never on the projector and is never mentioned in the slides.

**BM04 scenarios (leader, 2026-11-28).** The run sheet shows the ten demo scenarios exactly as committed in
BM04 (`capstone/Documents/tracking/BM04-commitment-scope.md`): DS-01a and DS-01b (WF-01, TanNB), DS-02a and
DS-02b (WF-02, KhoaDD), DS-03a and DS-03b (WF-03, HoangTK), DS-04a and DS-04b (WF-04, LongNN), DS-05a and
DS-05b (WF-05, LongLP). Each member demos the workflow they own, so the owner is the presenter of its rows.
The council passes 5 of 5 main scenarios (the `a` ids) and at least 4 of 5 exception scenarios (the `b`
ids). A BM04 id in the Time column marks the scenario the row opens or continues; a row without an id belongs
to the id above it in its section. A row marked (unhappy) without an id is an extra case the council's rules
ask for, outside BM04: the MF-01a duplicate registration, the MF-01b minimum order, the MF-01c battery, the
MF-03 Unrouted SOS and the MF-04 revoked key.

**Rows that run in parallel**, because their wait is real time on the live staging and no panel action
shortens it: DS-03b (the escalation timers, 7 minutes from the SOS to TrekLink Staff: the panel sends its SOS
at 12:20 inside MF-02, the Manager is shown at 18:30 and Staff at 19:40); DS-04b (the device operator
switches the unit off at about 15:30, it reads stale from about 20:30, shown at 21:45, cleared by 24:30); and
the DS-02a outage (the device operator cuts the uplink at 13:20 while the site clicker runs DS-02b). To
shorten, drop or cut the extra unhappy rows (0:45, 4:00, 8:45, 20:20, 24:00, about 2.5 minutes in all) and
the MF-02 slide row (11:00, 40 s); no BM04 row drops.

Roles. **Presenter** (speaks, never clicks). **Site clicker** (drives the projected laptop: windows A, B, C,
D, E, one browser profile per account, and terminal T). **Panel operator** (window P on their own device, on
the hotspot; presses only what the sheet names). **Device operator** (the device laptop with the gateway and
the real units; not projected).

Who (leader, 2026-11-28): each BM04 owner presents their flow: TanNB MF-01a to MF-01c, KhoaDD MF-02, HoangTK MF-03,
LongNN MF-04, LongLP MF-05. Site clicker LongLP; KhoaDD clicks during MF-05. Panel operator LongNN; TanNB holds
the panel during MF-04. Device operator KhoaDD.

### 15.1 Value sets, one per run

Every run uses its own set, so no organization, email, station or key repeats on the live database. The
council uses set C. Before a rehearsal, search the tax code in `/t/organizations` (**Search by code, name or
tax code**): it must not be found (2026-11-27, before rehearsal 2: none of these was on staging).

| Field | R1 | R2 | R3 | C (council) | Spare |
|---|---|---|---|---|---|
| Registered company name | Langbiang Highland Treks Co., Ltd. | Bidoup Ridge Adventures Co., Ltd. | Ta Nung Valley Expeditions Co., Ltd. | Cat Tien Forest Trekking Co., Ltd. | Dalat Pine Trails Co., Ltd. |
| Tax code | 5801234561 | 5801234562 | 5801234563 | 5801234564 | 5801234565 |
| Registered address | 25 Ba Thang Tu, Da Lat, Lam Dong | 9 Tran Phu, Lac Duong, Lam Dong | 61 Hai Ba Trung, Da Lat, Lam Dong | 14 Nguyen Van Troi, Bao Loc, Lam Dong | 3 Phan Dinh Phung, Da Lat, Lam Dong |
| Company phone | 0263 3822 101 | 0263 3839 202 | 0263 3824 303 | 0263 3864 404 | 0263 3821 505 |
| Manager full name | Nguyen Hoang Nam | Le Minh Chau | Tran Gia Huy | Pham Thu Trang | Do Bao Ngoc |
| Manager email | `treklink.dev+langbiang@gmail.com` | `treklink.dev+bidoup@gmail.com` | `treklink.dev+tanung@gmail.com` | `treklink.dev+cattien@gmail.com` | `treklink.dev+pinetrails@gmail.com` |
| Manager phone | 0912 345 601 | 0912 345 602 | 0912 345 603 | 0912 345 604 | 0912 345 605 |
| Master contract number | MC-2026-0101 | MC-2026-0102 | MC-2026-0103 | MC-2026-0104 | MC-2026-0105 |
| Duplicate registration email (MF-01a unhappy) | `treklink.dev+langbiang2@gmail.com` | `treklink.dev+bidoup2@gmail.com` | `treklink.dev+tanung2@gmail.com` | `treklink.dev+cattien2@gmail.com` | `treklink.dev+pinetrails2@gmail.com` |
| Holding fee receipt (MF-01c) | CT-2026-1101 | CT-2026-1102 | CT-2026-1103 | CT-2026-1104 | CT-2026-1105 |
| Field Station name (MF-01c) | Lang Biang ranger post | Bidoup ranger post | Ta Nung ranger post | Hon Giao ranger post | Pine Hill ranger post |
| API key name (MF-04) | Lang Biang ranger dashboard | Bidoup ranger dashboard | Ta Nung ranger dashboard | Hon Giao ranger dashboard | Pine Hill ranger dashboard |
| Closing invoice receipt (MF-05) | CT-2026-1111 | CT-2026-1112 | CT-2026-1113 | CT-2026-1114 | CT-2026-1115 |

Values every run shares: the new Manager's password from the team's private channel; MF-01b Plan
**Monthly**, variant **TrekLink v3 (GPS, SOS button)**, Quantity **4** (unhappy) then **5**, start today,
appointment the next full hour; DS-01b variant **TrekLink v4 (GPS, SOS, fall detection)**, Quantity **5**
(or the v4 count shown plus one when it reads 5 or more), never sent; MF-01c Battery **90** with GPS fix (unhappy row **35**), Method **Cash**,
Amount received the Due now shown (1,125,000 VND at 450,000 VND a month for five v3 units **(check by
hand: the v3 price on staging)**), Signing Manager **Pham Duc Huy**, identity document **CCCD ending
1234**; MF-03 **Ranger team dispatched from the Ta Nang post**, **Team at km 6, voice contact with the
hiker**, **Hiker found, minor ankle injury, walked out**; MF-05 reason **The trek season of Suong Ngan
Trekking ended early**, damage **Casing cracked (CASING_CRACKED)** on the fifth tag. DS-03b panel
**Rented unit for an SOS** **TL-0009** (RC-2026-0001). DS-02a and DS-04b type nothing: the device operator
switches the uplink and one unit (section 16).

Write on the sheet during the run: the new ORG code (MF-01a), the RC code and the five tags (MF-01b), the
handover time (MF-01c), the time of the DS-03b **Send SOS** (T, 12:20), the time the uplink comes back and the
time the DS-04b unit is switched off (DS-02a, DS-04b), the incident codes of DS-03a and DS-03b.

### 15.2 MF-01a, organization onboarding (0:00 to 4:00)

| Time | Presenter says | Site clicker | Typed | Expected on screen | Panel operator | Fallback |
|---|---|---|---|---|---|---|
| 0:00 DS-01a | "A trekking company registers itself online and gets its organization code at once." | E, `/`, **Register your organization**, the seven fields, **Register** | set C | "Registration received..." and "Your organization code is ORG-00xx": write it down | Watch | Not saved: panel playback **MF-01a**, **Start** (it registers its own run organization and pauses at the approval); go on at 2:00 with that code |
| 0:45 | "The same company cannot register twice." (unhappy) | E in another browser profile, `/register`, same fields, **Register** | set C, duplicate email | "This tax code is already registered."; no new code | | Accepted: say it, and reject the extra organization as D after the council |
| 1:15 | "Staff check the papers at the counter; Staff cannot approve." | B, `/t/organizations`, tab **Pending**, the new code; Counter verification: Method **In person**, tick **Business registration** and **Manager ID card**, Master contract number, tick both master contract boxes, **Record verification** | set C master contract | Toast "Saved."; "Verified ..., in person, contract MC-2026-0104"; no Approve for Staff | | Repeat; the button then reads **Update verification** |
| 2:00 | "Only an Admin approves." | D, `/t/organizations`, tab **Pending**, the code, **Approve** | | Toast "ORG-00xx approved. The Manager can now request devices." | If the MF-01a playback runs, it resumes by itself; otherwise **Resume** | **Approve** disabled: redo 1:15 as B |
| 2:30 | "The Manager gets an invitation code by mail." | Phone, team inbox, "Your TrekLink invitation code" to the set C email | | The code, valid 72 hours | | Absent after 1 minute: say the mail is on its way and skip to MF-01b; the Manager sets the password after the council |
| 3:15 | "The Manager sets a password and lands on the new organization." | E, `/sign-in`, **Set password**; Email, Invitation code, Password, Confirm password, **Set password and sign in** | set C email, the code, the password | Signed in on `/o`, the new organization's overview | | "Internal server error" on the first press (web#533, rehearsal 1): press once more |

### 15.3 MF-01b, rental request and approval (4:00 to 6:30)

DS-01b. BM04 writes "2 available, request 3". On the live staging `rentals.minOrderQuantity` is 5 (seed
migration `20261004120100_seed`), and the request page checks the minimum before the stock
(`ContractRequestPage.tsx:178-182`), so any quantity under 5 shows the 4:00 message instead of the stock. The
stock refusal therefore asks for 5 of a variant with fewer than 5 Available: TrekLink v4, 3 Available on
2026-11-26 (section 2). The page refuses it on **Next** from its own count (MSG11), nothing is sent and no
unit is held, so the v3 stock MF-01b needs is untouched; were the count not read, the server refuses the
request with the same text and the rollback holds nothing (`devices.service.ts:328-333`). No panel action is
needed and none changes stock.

| Time | Presenter says | Site clicker | Typed | Expected on screen | Panel operator | Fallback |
|---|---|---|---|---|---|---|
| 4:00 | "A request below the minimum order is refused before it is sent." (unhappy) | A, `/o`, **Request a contract**; Plan **Monthly**; card **TrekLink v3 (GPS, SOS button)**; Quantity; **Next** | 4 | "The minimum order is 5 devices." under Quantity; the page stays on the first step | | |
| 4:20 DS-01b | "Three units in stock, five asked: refused, with the stock shown." (unhappy) | A, the same step: card **TrekLink v4 (GPS, SOS, fall detection)**; Quantity; **Next** | 5 | The card reads "... per device per month, 3 available" and the line under Quantity "3 available now" with **Refresh**; on **Next**: "Only 3 TrekLink v4 (GPS, SOS, fall detection) devices are available. Lower the quantity or choose another variant." under Quantity; the page stays on the first step (seen for v3 on staging 2026-11-08, `docs/sessions/2026-11-08-1501-wf01-staging-rerun.md`) **(check by hand: the v4 count on the day)** | Watch: nothing to press | Count 5 or more: type the count plus one, the same refusal follows. "Checking availability..." or "Availability could not be read": **Refresh** once; still no count: say the stock check runs again on sending, and do not send |
| 4:45 DS-01a | "Five units, from today; they are held for 24 hours." | A: card **TrekLink v3 (GPS, SOS button)**, Quantity 5, **Next**; start today, **Next**; **Send request** | 5, today | "Request RC-2026-00xx sent", five devices held, the deposit due: write the RC code down | | No request: panel playback **MF-01b**, **Start** (requests and approves); go on at 6:30 with its code |
| 5:30 | "Staff approve with a handover appointment; the units are reserved." | B, `/t/contracts`, **Show** menu **Requested**, the RC code, **Show details**; Handover appointment; **Approve** | the next full hour | Toast "RC-2026-00xx approved. 5 devices reserved." and the five tags: write them down | | Panel action **Approve** on the contract |

### 15.4 MF-01c, payment and handover (6:30 to 11:00), DS-01a continued

| Time | Presenter says | Site clicker | Typed | Expected on screen | Panel operator | Fallback |
|---|---|---|---|---|---|---|
| 6:30 | "Staff prepare each unit at the counter." | B, **Open the contract**, **Start handover**; Devices: **Scan or type an asset tag**, **Find** | the first tag | "TL-.... is on this contract." | | **More actions**, **Open the counter** |
| 7:00 | "Readings and the organization's channel key, for all five at once." | Tick **Select all units**; **Battery % for selected**; **GPS fix for selected**; **Set readings for selected**; then on the first row Battery %; **Record provisioning for selected**; **Next** | 90; first row 35 | "Readings set on 5 units."; "Recorded 5 of 5." | | Readings row by row |
| 8:00 | "The holding fee is paid at the counter." | Payment: **Record a counter payment**; Method Cash; Amount received; **Receipt number**; **Record** | the Due now; CT-2026-1104 | "Payment of 1,125,000 VND received." | | `/t/billing`, the contract's first invoice |
| 8:45 | "A unit below the minimum battery cannot be handed over." (unhappy) | Preview note **Next**; Sign: **Signing Manager**, **Identity document checked**, the Manager signs, **Complete handover** | Pham Duc Huy; CCCD ending 1234 | Refused: "Battery below 50 % on TL-.... Charge before use, or acknowledge.", an amber banner under the signature box with **Proceed anyway** (do not press it) | | |
| 9:30 | "Charged, the handover completes and the note is signed." | Back to Devices, first row Battery % 90; Sign, **Complete handover** | 90 | "Handover complete. 5 devices issued under contract RC-2026-00xx."; Active: write the time down | | Panel playback **MF-01c**, **Start** (pays and hands over the approved ORG-0001 contract) |
| 10:30 | "The organization creates a Field Station credential for its base camp laptop." | A, `/o/field-stations`, **Create Field Station**, Name, **Create** | Hon Giao ranger post | The credential once, "Copy it now; it will not be shown again." Do not copy it on stage | | Skip and say it |

### 15.5 MF-02, device data through the Field Station bridge (11:00 to 16:30)

The real units of RC-2026-0006 report through the device laptop's station `fs-org-0001-3` "Outdoor test
station" (receiver a274). **The panel's MF-02
playback is forbidden while they send** (section 14).

DS-02a takes the station's uplink down on the device laptop while the gateway, and so its serial reader, keep
running: the device operator turns the laptop's network off (Wi-Fi off, or the network cable or the phone
tether out) and leaves the USB cable of the receiver a274 in. The gateway then keeps every packet in its
SQLite queue (log "MQTT connection closed. Storing upcoming events offline in SQLite.", `mqtt-client.ts:204`);
a row leaves the queue only on the broker's PUBACK, and on reconnect the queue flushes in tier order, P0 SOS
first (`mqtt-client.ts:224-243`, `gateway/src/mqtt/flush-outage.spec.ts` AC-03). The station's local page,
`http://127.0.0.1:4321/` on the device laptop (`GATEWAY_LOCAL_PORT`, `gateway/local-page/index.html`), shows
the badge, the queue by tier and the serial port, and needs no network. A link cut this way goes silent
without a reset, so the gateway may notice it only at its MQTT keepalive (`gateway/test/harness/README.md`,
"Not covered"; mqtt.js keeps alive every 60 s by default), up to about 90 s; the rows wait in the queue either
way. Every real unit was handed over long ago, so the SOS is attributed (D-040, section 1).

| Time | Presenter says | Site clicker | Typed | Expected on screen | Panel operator | Fallback |
|---|---|---|---|---|---|---|
| 11:00 DS-02a | "Node, LoRa, the base camp laptop over USB, a SQLite queue with SOS first, MQTT QoS 1, ingestion with eventId dedup. In a moment that laptop loses its internet." | The architecture slide | | | | |
| 11:40 | "These are the real units, live." | C, `/o/map`, **Live map** | | a274, a278, a294, TL-0001 and TL-0002 with battery and a recent last seen | Watch the Panel status | No recent report: device operator checks the gateway; then the fallback below |
| 12:20 DS-03b | "Another hiker sends an SOS. This one is simulated by us, and nobody will answer it: we come back to it in MF-03." | C, watch | | Red banner "SOS: TL-0009 (Vo Thi Mai Anh), hh:mm. Acknowledge now." (`seed-demo.ts:95`). **Nobody presses Acknowledge on TL-0009**, in any window, until the council ends | Action **Send SOS**, **Rented unit for an SOS** TL-0009 (RC-2026-0001, handed over long ago, so the 5-minute rule holds); write the time T on the sheet | Refused ("Choose a unit that is rented and in live custody.") or no banner in 20 s: say so; DS-03b is then told at 18:30 and not shown |
| 12:40 DS-02a | "Staff see the subscriber, the station and every event, attributed." | B, sidebar **Field data sync** | | MQTT subscriber up; the device laptop's station Connected with a Last sync; Recent field events of the real units, Attributed, Ingress Field Station; the TL-0009 SOS row, Ingress Node uplink | | Station "Never reported": its health report comes within 60 s |
| 13:20 DS-02b | "A packet received twice is stored once." (unhappy) | T: `npm --prefix backend run replay:mqtt -- position --times 2` with `MQTT_BROKER_URL`, `MQTT_USERNAME=node-!de000009`, `MQTT_PASSWORD` set beforehand; then B, refresh. **Device operator, at the same time:** the device laptop's network off; the gateway keeps running | | **Duplicates rejected** grows by one **(check by hand: as section 7 U1 and U2)** | | Say it and show the Sync audit's "Duplicate rejected" rows |
| 14:05 DS-02a | "While that ran, the base camp laptop lost its internet. The radio side keeps working: packets still arrive over USB and wait in the SQLite queue." | Device operator: the local page on the device laptop, turned to the council **(check by hand: the council can see the device laptop's screen)** | | Badge "Uplink: offline, queuing"; Broker "Not connected"; Queue "P2 position" or "P3 telemetry" above 0 and "Waiting to send" growing; Serial port open and "Last packet" still moving | | Badge still "Uplink: connected": the keepalive has not fired yet (up to about 90 s); "Waiting to send" grows all the same. "Waiting to send" still 0: no unit has reported since the cut; wait up to 30 s **(check by hand: how often the real units report)** |
| 14:45 | "Now the hiker presses SOS, while the uplink is still down." | Device operator: press the SOS control of the RC-2026-0006 unit agreed in rehearsal once (never TL-0001, section 8; never a274, the receiver) **(check by hand: the SOS control of a v2 unit)** | | Local page: the red SOS notice **(check by hand: its wording)**; "P0 SOS" 1, queued after the P2 and P3 rows already waiting | | No P0 row in 30 s: say the SOS did not reach the station; go on at 15:25 with the telemetry only, and show SOS first with the harness below |
| 15:25 | "The uplink comes back." | Device operator: the network on again. Then switch the DS-04b unit off (section 16) and write the time on the sheet | | Gateway log "Connected to MQTT broker. Triggering queue flush..." then "Flushing N prioritized events from the SQLite queue..." (`mqtt-client.ts:191, 257`); local page "Uplink: connected", "Waiting to send" 0 and a new "Last successful send" | | No reconnect in 30 s: check the network is back; the gateway retries every 3 s (`GATEWAY_MQTT_RECONNECT_PERIOD_MS`); restart nothing |
| 15:45 | "The SOS, pressed last, went out first; every event is stored once." | B, **Field data sync**, **Refresh** | | Field Stations: the device laptop's station Connected with a new Last flush. Recent field events: the outage's rows, Ingress Field Station, Attributed, the SOS row (Kind SOS) received before every POSITION and TELEMETRY row that was queued ahead of it, so in the newest-first list it sits below them **(check by hand: the list's default order)**. The Received column shows minutes only, so read the order of the rows. Sync audit, **Show** menu Every outcome: one "Accepted" row per event; a publish the cut left unacknowledged comes again as "Duplicate rejected" and is stored once (`mqtt-client.ts:224-232`). C's window gets the SOS banner of one new incident | | Order not readable: open the SOS row and a TELEMETRY row of the outage and compare their Received times **(check by hand: the detail pane shows seconds)**; else say it and run the harness below |

Fallbacks. When the real units cannot report at all (the device operator confirms on **Field data sync**
that none of them sent in the last 5 minutes): panel playback **MF-02**, **Start**; the presenter says the
positions are simulated, and DS-02a is shown with the harness below. The MF-02 playback is never pressed while
the RC-2026-0006 units send (section 14), so it is no fallback for the SOS of DS-02a. When the real SOS does
not reach the queue at 14:45 (no SOS incident came from the real units on 2026-11-25, section 12): the
telemetry rows still show the queue, the flush and the stored-once count. For SOS first, the device operator
runs the gateway's outage harness in a second terminal on the device laptop, from `gateway/`: it builds its own
simulated station and an in-process broker, so the running gateway and its serial reader are untouched, and the
presenter says it is simulated: `npm run harness:outage -- --outage 20 --trials 1 --min-trials 1 --warmup 5
--tail 5` with stdout discarded (`> NUL` in cmd, `> $null` in PowerShell). A trial takes its outage plus about
13 s with these warm-up and tail values; the report, on stderr, ends with a row per condition whose NFR-REL-04
column reads the share of outage P0 that arrived before any P2 or P3, for example "12/12 (100.00 %): pass"
(`gateway/test/harness/README.md`) **(check by hand: the harness runs on the device laptop)**. MF-03 then
starts from the panel's **Send SOS** on TL-0010 (15.6). A fallback SOS never goes on a unit of the contract
MF-01c handed over at about 10:00: inside the 5-minute margin it would be Unattributed and open an Unrouted
incident (D-040, section 1).

### 15.6 MF-03, SOS to incident (16:30 to 21:00)

DS-03a handles the incident the DS-02a flush opened. DS-03b is the TL-0009 incident the panel opened at 12:20
(T). The escalation waits are real time, set by the seeded parameters (seed migration
`20261004120100_seed`, lines 41 to 43): `incidents.primaryAckTimeoutSeconds` 120 s,
`incidents.backupAckTimeoutSeconds` 120 s, `incidents.managerAckTimeoutSeconds` 180 s, checked every 5 s
(`incidents.tierTimeouts`, `incident-timers.job.ts:186`) **(check by hand: the three values on the staging
Parameters page)**. So TL-0009 reads Notifying primary from T, Notifying backup from T+2:00, Notifying manager
from T+4:00 and Escalated from T+7:00 (with T at 12:20: 14:20, 16:20 and 19:20); each move is a history step
"No acknowledgement in time" (`frontend/src/entities/incident/api.ts:181`). The Manager sees it in window A,
Staff in window B; no panel action advances a tier on the live staging (the demo clock's next-tier step lives
in Demo control, which is off there, section 1). On ORG-0001 the backup is the Manager too (roster: Operator
primary, Manager backup, section 2), so Pham Duc Huy is alerted from the backup tier on, and the Manager tier
alerts him again.

| Time | Presenter says | Site clicker | Typed | Expected on screen | Panel operator | Fallback |
|---|---|---|---|---|---|---|
| 16:30 DS-03a | "The SOS from the outage reaches the on-duty Operator." | C, `/o/incidents`, the new incident of the real unit (not TL-0009): write its code down | | Red banner "SOS: <tag> (<holder>), hh:mm. Acknowledge now.", hh:mm the time it was pressed during the outage; the TL-0009 banner may show beside it: leave it | If DS-02a brought no SOS: action **Send SOS**, **Rented unit for an SOS** TL-0010 | Presenter says the SOS from TL-0010 is simulated |
| 16:50 | "The Operator takes ownership; escalation stops." | C, on the incident's page, **Acknowledge** (never the banner's button, which may name TL-0009) | | Toast "Saved."; Owner Nguyen Thanh Tung, Acknowledged | | State already Notifying backup (the primary tier ran out 120 s after the flush): acknowledge all the same, a notifying tier accepts it (`incident-lifecycle.ts:68-74`), and say why. Else panel action **Acknowledge** on the incident |
| 17:30 | "The response is recorded." | C, **Response under way**, What is being done, **Save response**; **Add status**, the line, save | the two prepared lines | State Responding; the update with author and time | | Panel action **Response under way** |
| 18:30 DS-03b | "The other SOS: the primary and the backup did not answer, so it has reached the Manager." | A, `/o/incidents`, the TL-0009 incident, **Show details** | | State "Notifying manager", no owner; History: the moves to Notifying backup and Notifying manager, each "No acknowledgement in time" **(check by hand: the History layout)**. A does not acknowledge | | Already Escalated (T was early): show the Notifying manager step in the History with its time |
| 19:00 DS-03a | "The outcome closes the episode; the history keeps every step." | C, **Report outcome**, Outcome, **Resolve incident** | the prepared outcome | State Resolved; History lists each step | | Panel action **Resolve** |
| 19:40 DS-03b | "The Manager did not answer either, so it is now with TrekLink Staff." | B, `/t/incidents`, **Show** menu **Escalated**, the TL-0009 row, **Show details** | | State Escalated; History adds the move to Escalated, "No acknowledgement in time"; B's banner lists TL-0009 (`AlertBanner.tsx:71-75`) | | Still Notifying manager: T was late; wait to T+7:05 (read T on the sheet), go on with 20:20 meanwhile, then come back |
| 20:20 | "An SOS with no rental behind it goes to TrekLink Staff, Unrouted." (unhappy) | B, `/t/incidents`, **Show** menu **Unrouted**, INC-2026-000001, **Show details** | | Owner "TrekLink Staff queue", state Unrouted. Say the 5-minute rule (section 1) | | Show the row only; leave it Unrouted |

The real SOS of DS-03a is the one the device operator pressed during the DS-02a outage (14:45), on the
RC-2026-0006 unit agreed in the rehearsals (handed over long ago, never TL-0001: section 8). Its incident
opens when the queue flushes, at about 15:25, so its primary tier runs out at about 17:25: the 16:50
**Acknowledge** must not slip. If the real SOS arrives after the panel's TL-0010 SOS, the second incident is
marked **False alarm** by C after the council. The TL-0009 incident stays Escalated to the end; after the
council the panel operator closes it (section 11 step 3).

### 15.7 MF-04, live map and the organization API (21:00 to 25:00)

DS-04b. The live map marks a unit stale when its last report is older than `monitoring.deviceStaleSeconds`,
300 s (seed migration `20261004120100_seed` line 48; read 300 s on the staging Parameters page on
2026-11-04, `docs/sessions/2026-11-04-1250-wf04-staging-run.md`), re-checked against the clock every 15 s
(`LiveMapPage.tsx:45`). The unit then reads the badge "Offline" and "Offline, last seen <date>, <time>", and
the header counts it offline (`LiveMapPage.tsx:41-42, 91, 232`); its next report clears it. The
`staleAfterSeconds` of Field data sync is the station threshold, `monitoring.fieldStationStaleSeconds` 180 s
(`sync-status.service.ts:85`), not the device one. The silencing controls of the demo field simulation
(`FieldSimulationSection.tsx:181, 561`) are part of Demo control, which is off on the live staging, so a
real unit is switched off instead: the device operator switches the DS-04b unit off right after the DS-02a
restore (about 15:30) and on again at 21:45.

| Time | Presenter says | Site clicker | Typed | Expected on screen | Panel operator | Fallback |
|---|---|---|---|---|---|---|
| 21:00 DS-04a | "Every unit of the organization, with battery and last seen; none of another organization's." | C, `/o/map`, **Live map**; **Search asset tag, holder or contract** | TL-0010 | The ORG-0001 units of RC-2026-0001, RC-2026-0006 and the new contract, none of RC-2026-0004 (ORG-0002); one row for TL-0010 | | Clear the search |
| 21:45 DS-04b | "This unit has been silent for more than five minutes: it shows stale, with when it was last heard." | C, clear the search; the DS-04b unit's row. **Device operator:** switch the unit on again | | Badge "Offline", "Offline, last seen <today>, <the switch-off time or just before>"; the header "N live, N offline, N not heard since handover" counts it offline | | Still live: the unit was not off for 5 minutes; say it and show the row again at 24:30 |
| 22:15 DS-04a | "Hoang Sa and Truong Sa are drawn as Vietnamese territory on every map." | C, zoom out to 6 or 7, drag left | | "Quần đảo Hoàng Sa (Việt Nam)" and "Quần đảo Trường Sa (Việt Nam)" | | Tiles slow: the masks draw without tiles |
| 22:45 | "Staff see every organization, then one." | B, `/t/map`, **Fleet map**, organization filter ORG-0001 | | Every organization's units, then ORG-0001 only | | |
| 23:15 | "An API key feeds the organization's own dashboard." | A, `/o/api-keys`, **Create API key**, Name, create; copy it to T | Hon Giao ranger dashboard | The key once with **Copy** | | |
| 23:45 | | T: `curl -s -H "X-Api-Key: <key>" <staging>/api/telemetry/devices` | | 200, `result.devices` with ORG-0001's units | | Show the Live map instead |
| 24:00 | "A revoked key is refused." (unhappy) | A, the key's row, **Revoke**, confirm; T, the same `curl` | | Toast "API key revoked"; then 401, "Authentication required." | | |
| 24:30 DS-04b | "It reported again, so it is live again." | C, `/o/map`, **Live map**, the DS-04b unit's row | | No Offline badge; "Last seen <today>, <a time after 21:45>" ("No position yet, last seen ..." for a unit without a GPS fix); the header counts it live | | Still Offline: the unit has not reported since it was switched on **(check by hand: time from switch-on to the first report)**; say it clears at its next report and show it after MF-05 |

### 15.8 MF-05, term end to close (25:00 to 29:00)

The contract is the one MF-01c handed over (the RC code and five tags on the sheet), never RC-2026-0006.

| Time | Presenter says | Site clicker | Typed | Expected on screen | Panel operator | Fallback |
|---|---|---|---|---|---|---|
| 25:00 DS-05a | "The Manager ends the rental early." | A, `/o/contracts`, the RC code, **Give notice**, confirm; **More actions**, **End contract now**, Reason, confirm | the prepared reason | Badge Ending, then "Contract ended. Check the units in at the counter." | | "Internal server error" (rehearsal 1, web#534): do not press again; open the contract, it has ended |
| 26:00 | "The units come back at the counter." | B, `/t/contracts`, **Show** menu All, the RC code, **Open the contract**, **Record return**; Check-in: the five tags | the five tags | "Check-in complete. 5 of 5 devices returned." (rehearsal 2; it took about 10 s on the staging) | | Tags one at a time |
| 26:45 | "Each unit is reset and inspected before it can be rented again." | Reset and inspection: **Record reset** on each, tick the three steps; tags one to four **Inspect**, Passed, **Record inspection** | | "Reset logged"; four units Available | | |
| 27:40 DS-05b | "A damaged unit goes to maintenance and is charged on the closing invoice." (unhappy) | The fifth tag: **Inspect**, **Damaged**, tick Antenna broken (ANTENNA_BROKEN) and Casing cracked (CASING_CRACKED), **Record inspection** | | "Damaged, maintenance", "Damage 700,000 VND, waiting for an Admin" | | |
| 28:05 | "A charge above 500,000 VND needs a second person: an Admin who did not inspect the unit decides it." | D, `/t/damage-charges`, **Show** menu Waiting for an Admin, the tag's row, **Decide**, **Approve**, Reason, **Record decision** | Antenna and casing damage confirmed at the counter | Toast "Saved."; status Approved | | **Decide** disabled: the Admin inspected the unit; the inspection is always B's. Rehearse 27:40 to 29:00: the close keeps about 25 s |
| 28:35 DS-05a, DS-05b | "Open balances are settled; the contract closes." | Tab **Close**: when it shows a balance due, **Open the invoices**, the Closing invoice, **Record counter payment**, Cash, receipt, **Record**; when TrekLink owes, section 10 step 9b; then **Close contract**, confirm | CT-2026-1114 | "RC-2026-00xx closed."; badge Closed | | Panel playback **MF-05**, **Start** (ends this contract, returns every unit Passed, pays and closes; the damaged case is then only told) |

After the council: section 11 for set C.

## 16. Pre-council checklist, Fri 2026-12-04

Done by the leader and the panel operator from 17:30, signed off by 19:00.

- [ ] **Deploy frozen.** No `up.sh` since Sat 2026-11-28; `status.sh` shows the frozen commit.
- [ ] **Health.** `GET <staging>/api/health` shows `"database":"up"` and `"mqtt":"up"` (`deploy/aws/RUNBOOK.md`).
- [ ] **Panel writable.** `/demo/panel` opens with the password over the hotspot; the Panel status shows it writable **(check by hand: the status wording)**; no playback runs.
- [ ] **Stock.** At least 5 v3 Available (MF-01b requests 5 TrekLink v3 units; 6 on 2026-11-26); otherwise section 11 step 2 for units in maintenance.
- [ ] **DS-01b stock.** On `/o/contracts/new` as A, the card **TrekLink v4 (GPS, SOS, fall detection)** reads under 5 available (3 on 2026-11-26); if it reads 5 or more, the sheet's DS-01b quantity is that count plus one. Leave the page with **Cancel**, nothing sent.
- [ ] **DS-02a outage switch.** On the device laptop, the operator has rehearsed taking the network down and back (Wi-Fi off and on, or the cable or tether out and in) with the gateway running: the local page `http://127.0.0.1:4321/` reads "Uplink: offline, queuing" within about 90 s, "Last packet" keeps moving, and on restore "Waiting to send" drains to 0 **(check by hand: the device laptop's network path)**. The local page is open in a browser on the device laptop, "Waiting to send" reads 0 before the start, and the way to show its screen to the council is agreed.
- [ ] **DS-02a SOS unit.** The RC-2026-0006 unit for the SOS is agreed (never TL-0001, never the receiver a274) and its SOS control rehearsed through the station once, with a Resolved and closed incident afterwards (section 11 step 3).
- [ ] **DS-02a harness fallback.** `npm ci` done at the repository root on the device laptop; a second terminal open in `gateway/` with the harness command of section 15.5 typed, not run.
- [ ] **DS-03b.** The panel's **Rented unit for an SOS** lists TL-0009; no incident is open on TL-0009; the ORG-0001 roster still reads Operator primary, Manager backup; the panel operator has a clock to write T.
- [ ] **DS-04b unit.** One RC-2026-0006 unit is agreed for DS-04b (never a274, never the DS-02a SOS unit), the device operator knows how to switch it off and on, and in rehearsal it reported again within 2.5 minutes of switching on **(check by hand: how the unit switches off and how soon it reports after boot)**. Every real unit reports at least once every 5 minutes, or the live map reads it Offline without being silenced **(check by hand)**.
- [ ] **Real units.** a274, a278, a294, TL-0001 and TL-0002 charged, Rented on RC-2026-0006, reporting on **Field data sync** within the last 5 minutes; the gateway runs on the device laptop with the receiver on COM5, a unit ORG-0001 holds (web#547).
- [ ] **No leftovers.** No incident open but INC-2026-000001; no Requested or Approved contract of ORG-0001; no unpaid invoice of an earlier run; no Active API key of an earlier run; RC-2026-0001 and RC-2026-0006 Active.
- [ ] **Value set C unused.** Its tax code is not found in `/t/organizations`.
- [ ] **Password set** by the leader and shared in the private channel; the panel operator has signed in once.
- [ ] **Laptops.** Projected laptop: one browser profile per window, A, B, C and D signed in and parked on their first page, E not signed in; terminal T with `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` set and the `curl` line typed; nothing reloads (a reload signs out). Device laptop charged and plugged in. Phone with the team inbox open. Hotspot phone charged.
- [ ] **Printed.** This run sheet with set C, one copy per role.
- [ ] **Rehearsed.** Section 12 shows at least three logged runs of each flow, with section 11 between runs.
